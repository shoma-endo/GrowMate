type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'lt' | 'in' | 'is' | 'gte'; column: string; value: unknown };
type Operation = 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';
type Result = { data: unknown; error: { code?: string; message: string } | null };

const store: Record<string, Row[]> = {};

const injectedErrors: Array<{ table: string; operation: Operation; error: { code?: string; message: string } }> = [];

export function resetStore(): void {
  for (const key of Object.keys(store)) delete store[key];
  injectedErrors.splice(0);
}

export function rows(table: string): Row[] {
  store[table] ??= [];
  return store[table];
}

/** 次に table への operation（rpc は関数名）が実行されたとき、1回だけ error を返す */
export function failNext(table: string, operation: Operation, error = { message: 'injected' }): void {
  injectedErrors.push({ table, operation, error });
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(({ op, column, value }) => {
    const actual = row[column];
    if (op === 'eq' || op === 'is') return actual === value;
    if (op === 'in') return (value as unknown[]).includes(actual);
    if (op === 'gte') return String(actual) >= String(value);
    return String(actual) < String(value);
  });
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orderedBy: string | null = null;
  private ascending = true;
  private count: number | null = null;
  private returnsRows = false;
  private one = false;

  constructor(
    private readonly table: string,
    private readonly operation: Operation,
    private readonly values?: Row,
    private readonly conflictColumn?: string
  ) {}

  select(): this { this.returnsRows = true; return this; }
  eq(column: string, value: unknown): this { this.filters.push({ op: 'eq', column, value }); return this; }
  lt(column: string, value: unknown): this { this.filters.push({ op: 'lt', column, value }); return this; }
  gte(column: string, value: unknown): this { this.filters.push({ op: 'gte', column, value }); return this; }
  in(column: string, value: unknown[]): this { this.filters.push({ op: 'in', column, value }); return this; }
  is(column: string, value: unknown): this { this.filters.push({ op: 'is', column, value }); return this; }
  order(column: string, options: { ascending?: boolean }): this {
    this.orderedBy = column;
    this.ascending = options.ascending !== false;
    return this;
  }
  limit(count: number): this { this.count = count; return this; }
  maybeSingle(): this { this.one = true; return this; }

  private execute(): Result {
    const injected = injectedErrors.findIndex(e => e.table === this.table && e.operation === this.operation);
    const injectedError = injected >= 0 ? injectedErrors.splice(injected, 1)[0] : undefined;
    if (injectedError) return { data: null, error: injectedError.error };
    const tableRows = rows(this.table);
    if (this.operation === 'insert') {
      const inserted = { ...this.values };
      tableRows.push(inserted);
      return { data: this.one ? inserted : [inserted], error: null };
    }
    if (this.operation === 'upsert') {
      const key = this.conflictColumn ?? 'id';
      const existing = tableRows.find(row => row[key] === this.values?.[key]);
      if (existing) Object.assign(existing, this.values);
      else tableRows.push({ ...this.values });
      return { data: null, error: null };
    }

    let selected = tableRows.filter(row => matches(row, this.filters));
    if (this.operation === 'update') {
      selected = selected.map(row => Object.assign(row, this.values));
      if (!this.returnsRows) return { data: null, error: null };
    } else if (this.operation === 'delete') {
      store[this.table] = tableRows.filter(row => !selected.includes(row));
      return { data: null, error: null };
    }
    if (this.orderedBy) {
      const key = this.orderedBy;
      selected = [...selected].sort((left, right) => {
        const result = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
        return this.ascending ? result : -result;
      });
    }
    if (this.count !== null) selected = selected.slice(0, this.count);
    // 実 DB と同じく、返す行は store の行とは別のオブジェクトにする
    const copies = selected.map(row => ({ ...row }));
    return { data: this.one ? copies[0] ?? null : copies, error: null };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

type StartBatchArgs = {
  p_user_id: string;
  p_new_media_ids: string[];
  p_resume_job_ids: string[];
  p_stale_before: string;
};

/** migration の `start_instagram_blog_draft_batch` と同じ結果を返す（1トランザクション・ユーザーごとのロック相当） */
function startBatch(args: StartBatchArgs): Result {
  const jobs = rows('instagram_blog_draft_jobs');
  const isUnfinished = (job: Row) => job.status === 'queued' || job.status === 'running';
  if (jobs.some(job => job.user_id === args.p_user_id && isUnfinished(job) && String(job.updated_at) >= args.p_stale_before)) {
    return { data: [], error: null };
  }
  const batchId = crypto.randomUUID();
  rows('instagram_blog_draft_batches').push({ id: batchId, user_id: args.p_user_id, chain_count: 0, notified_at: null });
  const now = new Date(Date.now()).toISOString();
  const originalBatchIds = new Set<string>();
  let resumed = 0;
  for (const job of jobs) {
    if (!args.p_resume_job_ids.includes(String(job.id)) || job.user_id !== args.p_user_id) continue;
    const stopped = job.status === 'failed' || (isUnfinished(job) && String(job.updated_at) < args.p_stale_before);
    if (!stopped) continue;
    originalBatchIds.add(String(job.batch_id));
    Object.assign(job, {
      batch_id: batchId,
      status: 'queued',
      error_code: null,
      completed_at: null,
      continuation_count: job.continuation_count === null ? null : 0,
      updated_at: now,
    });
    resumed += 1;
  }
  let started = 0;
  for (const mediaId of args.p_new_media_ids) {
    const owned = rows('instagram_media').some(media => media.id === mediaId && media.user_id === args.p_user_id);
    if (!owned || jobs.some(job => job.instagram_media_id === mediaId)) continue;
    jobs.push({
      id: `job-${mediaId}`,
      user_id: args.p_user_id,
      instagram_media_id: mediaId,
      batch_id: batchId,
      status: 'queued',
      stage: 'keywords',
      updated_at: now,
    });
    started += 1;
  }
  if (started + resumed === 0) {
    store.instagram_blog_draft_batches = rows('instagram_blog_draft_batches').filter(batch => batch.id !== batchId);
  }
  return {
    data: [{ batch_id: batchId, started, resumed, original_batch_ids: [...originalBatchIds] }],
    error: null,
  };
}

const fakeClient = {
  async rpc(name: string, args: StartBatchArgs): Promise<Result> {
    const injected = injectedErrors.findIndex(e => e.table === name && e.operation === 'rpc');
    const injectedError = injected >= 0 ? injectedErrors.splice(injected, 1)[0] : undefined;
    if (injectedError) return { data: null, error: injectedError.error };
    if (name !== 'start_instagram_blog_draft_batch') throw new Error(`unexpected rpc: ${name}`);
    return startBatch(args);
  },
  from(table: string) {
    return {
      select: () => new Query(table, 'select'),
      insert: (values: Row) => new Query(table, 'insert', values),
      update: (values: Row) => new Query(table, 'update', values),
      delete: () => new Query(table, 'delete'),
      upsert: (values: Row, options?: { onConflict?: string }) =>
        new Query(table, 'upsert', values, options?.onConflict),
    };
  },
};

/** `SupabaseService` の差し替え。Runner が継承して使うメソッドだけを持つ */
export class FakeSupabaseService {
  getClient() {
    return fakeClient;
  }

  async getChatSessionById(sessionId: string, userId: string) {
    const session = rows('chat_sessions').find(row => row.id === sessionId && row.user_id === userId);
    return { success: true as const, data: session ?? null };
  }

  async createChatSession(session: Row) {
    rows('chat_sessions').push({ ...session });
    return { success: true as const, data: undefined };
  }
}
