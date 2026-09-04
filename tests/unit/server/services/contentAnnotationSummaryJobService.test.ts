import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SummaryTargetFieldKey } from '@/lib/content-annotation-summary-fields';

/**
 * AI要約一括のバックグラウンド実行（ジョブ処理サービス）のユニットテスト。
 * 正本: docs/plans/content-annotation-bulk-summary-background-spec.md §7 / §13
 *
 * ここで固定するのは、実データでは再現できない or 再現しても気づけない性質に絞る:
 * - 時間予算の打ち切りが**戻り値**で判定されていること（経過秒の閾値比較でないこと）
 * - 進捗がチャンク境界でしか保存されないこと（着手済みの記事を飛ばさない）
 * - `attempt_count` が「連続無進捗回数」であること（前進のある継続で failed にならない）
 * - 完了メールの起動経路（掃き出し・冪等・宛先なし・24時間の窓）
 * - 429 と WordPress 連携切れの計上先
 * - cron レスポンスの `data.failed` に記事単位の失敗を含めないこと
 */

const mocks = vi.hoisted(() => ({
  generateSummary: vi.fn(),
  saveSummary: vi.fn(),
  sendCompletionEmail: vi.fn(),
  canFetchWpPostContentLive: vi.fn(),
  computeSummaryItemBudgetMs: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_SITE_URL: 'https://example.test' } }));

vi.mock('@/server/services/contentAnnotationSummaryService', () => ({
  contentAnnotationSummaryService: {
    generateSummary: mocks.generateSummary,
    saveSummary: mocks.saveSummary,
  },
}));

vi.mock('@/server/services/emailService', () => ({
  emailService: { sendContentAnnotationSummaryCompletion: mocks.sendCompletionEmail },
}));

vi.mock('@/server/services/wordpressContentSync', () => ({
  canFetchWpPostContentLive: mocks.canFetchWpPostContentLive,
}));

// 予算判定は**戻り値**で行う契約なので、戻り値そのものをモックして検証する。
// 経過秒の閾値比較で実装されていると、null を返してもループが止まらず落ちる
vi.mock('@/server/lib/content-annotation-bulk-summary', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@/server/lib/content-annotation-bulk-summary')
  >();
  return { ...actual, computeSummaryItemBudgetMs: mocks.computeSummaryItemBudgetMs };
});

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return fakeClient;
    }
  },
}));

// ---------------------------------------------------------------------------
// 最小の Supabase フェイク（このサービスが実際に使うチェーンだけを実装する）
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = ['eq' | 'is' | 'gte', string, unknown] | ['in', string, unknown[]];

interface FakeStore {
  content_annotation_summary_jobs: Row[];
  content_annotations: Row[];
  users: Row[];
}

let store: FakeStore;
/** 進捗保存の呼び出しを記録する（チャンク境界でしか呼ばれないことの検証に使う） */
let progressUpdates: Row[];

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(filter => {
    const [op, column, value] = filter;
    const actual = row[column];
    if (op === 'eq') return actual === value;
    if (op === 'is') return actual === value || (value === null && actual === undefined);
    if (op === 'gte') return String(actual) >= String(value);
    return (value as unknown[]).includes(actual);
  });
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private orderColumn: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;
  private single = false;
  private selected = false;

  constructor(
    private readonly table: keyof FakeStore,
    private readonly op: 'select' | 'insert' | 'update',
    private readonly values: Row | null
  ) {}

  select(): this {
    this.selected = true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push(['eq', column, value]);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push(['in', column, values]);
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push(['is', column, value]);
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push(['gte', column, value]);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAsc = options?.ascending !== false;
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private run(): { data: unknown; error: unknown } {
    const rows = store[this.table];

    if (this.op === 'insert') {
      const inserted: Row = {
        id: `job-${rows.length + 1}`,
        status: 'pending',
        job_token: null,
        processed_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        skipped_count: 0,
        failed_by_code: {},
        attempt_count: 0,
        last_error: null,
        notified_at: null,
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        ...(this.values ?? {}),
      };
      // 部分ユニークインデックス（1利用者につき未完了ジョブは1件）
      const conflict = rows.some(
        row =>
          row.user_id === inserted.user_id &&
          (row.status === 'pending' || row.status === 'processing')
      );
      if (conflict) {
        return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      rows.push(inserted);
      return { data: this.single ? inserted : [inserted], error: null };
    }

    let selectedRows = rows.filter(row => matches(row, this.filters));

    if (this.op === 'update') {
      if (this.table === 'content_annotation_summary_jobs' && this.values) {
        progressUpdates.push({ ...this.values, __matched: selectedRows.length });
      }
      selectedRows = selectedRows.map(row => Object.assign(row, this.values ?? {}));
    }

    if (this.orderColumn) {
      const column = this.orderColumn;
      selectedRows = [...selectedRows].sort((left, right) => {
        const a = String(left[column] ?? '');
        const b = String(right[column] ?? '');
        return this.orderAsc ? a.localeCompare(b) : b.localeCompare(a);
      });
    }
    if (this.limitCount !== null) selectedRows = selectedRows.slice(0, this.limitCount);

    if (this.single) return { data: selectedRows[0] ?? null, error: null };
    if (this.op === 'update' && !this.selected) return { data: null, error: null };
    return { data: selectedRows, error: null };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/**
 * claim RPC のフェイク。**migration の SQL と同じ規則を写している**
 * （`supabase/migrations/20260904000000_add_content_annotation_summary_jobs.sql`）。
 * SQL 自体の検証はローカル/ステージング適用で行う。ここで固定したいのは
 * 「アプリ層が attempt_count をリセットするので、前進する限り failed に落ちない」こと。
 */
function fakeClaim(limit: number): Row[] {
  const now = Date.now();
  const stuck = (row: Row) =>
    row.status === 'processing' &&
    now - new Date(String(row.started_at ?? 0)).getTime() >= 20 * 60 * 1000;

  for (const row of store.content_annotation_summary_jobs) {
    if (Number(row.attempt_count) >= 3 && (row.status === 'pending' || stuck(row))) {
      row.status = 'failed';
      row.last_error = row.last_error ?? 'AI要約ジョブが前進しないまま中断しました';
      row.finished_at = new Date().toISOString();
    }
  }

  const claimable = store.content_annotation_summary_jobs
    .filter(row => Number(row.attempt_count) < 3 && (row.status === 'pending' || stuck(row)))
    .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
    .slice(0, limit);

  return claimable.map(row => {
    row.status = 'processing';
    row.attempt_count = Number(row.attempt_count) + 1;
    row.started_at = new Date().toISOString();
    row.last_error = null;
    row.job_token = `token-${row.attempt_count}-${row.id}`;
    return {
      id: row.id,
      user_id: row.user_id,
      target_annotation_ids: row.target_annotation_ids,
      total_count: row.total_count,
      processed_count: row.processed_count,
      succeeded_count: row.succeeded_count,
      failed_count: row.failed_count,
      skipped_count: row.skipped_count,
      failed_by_code: row.failed_by_code,
      attempt_count: row.attempt_count,
      job_token: row.job_token,
    };
  });
}

let rpcFailure: string | null = null;

const fakeClient = {
  from(table: keyof FakeStore) {
    return {
      select: () => new FakeQuery(table, 'select', null).select(),
      insert: (values: Row) => new FakeQuery(table, 'insert', values),
      update: (values: Row) => new FakeQuery(table, 'update', values),
    };
  },
  rpc(_name: string, args: { p_limit: number }) {
    if (rpcFailure) return Promise.resolve({ data: null, error: { message: rpcFailure } });
    return Promise.resolve({ data: fakeClaim(args.p_limit), error: null });
  },
};

// ---------------------------------------------------------------------------

import { contentAnnotationSummaryJobService } from '@/server/services/contentAnnotationSummaryJobService';

const USER_ID = 'user-1';
const BUDGET = { itemMs: 240_000, llmMs: 180_000 };

const emptyFields: Record<SummaryTargetFieldKey, string | null> = {
  main_kw: null,
  kw: null,
  needs: null,
  persona: null,
  goal: null,
  prep: null,
  opening_proposal: null,
  basic_structure: null,
};

const annotation = (id: string, overrides: Partial<Row> = {}): Row => ({
  id,
  user_id: USER_ID,
  wp_post_id: 1,
  canonical_url: null,
  ...emptyFields,
  ...overrides,
});

const generated = (annotationId: string) => ({
  success: true,
  fields: { ...emptyFields, main_kw: 'kw', impressions: null },
  annotationId,
  userId: USER_ID,
});

function seedJob(overrides: Partial<Row> = {}): Row {
  const ids = (overrides.target_annotation_ids as string[]) ?? ['a1'];
  const job: Row = {
    id: 'job-1',
    user_id: USER_ID,
    status: 'pending',
    job_token: null,
    target_annotation_ids: ids,
    total_count: ids.length,
    processed_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    skipped_count: 0,
    failed_by_code: {},
    attempt_count: 0,
    last_error: null,
    notified_at: null,
    created_at: '2026-09-04T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
  store.content_annotation_summary_jobs.push(job);
  return job;
}

function jobRow(id = 'job-1'): Row {
  const row = store.content_annotation_summary_jobs.find(item => item.id === id);
  if (!row) throw new Error(`job ${id} not found`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = {
    content_annotation_summary_jobs: [],
    content_annotations: [],
    users: [{ id: USER_ID, email: 'user@example.test' }],
  };
  progressUpdates = [];
  rpcFailure = null;
  mocks.computeSummaryItemBudgetMs.mockReturnValue(BUDGET);
  mocks.canFetchWpPostContentLive.mockResolvedValue(true);
  mocks.saveSummary.mockResolvedValue({ success: true, data: {} });
  mocks.sendCompletionEmail.mockResolvedValue({ success: true, messageId: 'm1' });
  mocks.generateSummary.mockImplementation(
    async ({ target }: { target: { annotationId: string } }) => generated(target.annotationId)
  );
});

describe('起票（AC-B01 / AC-B07 / AC-B11）', () => {
  it('ジョブを1件作り、対象IDを配列で固定する', async () => {
    const result = await contentAnnotationSummaryJobService.createJob({
      userId: USER_ID,
      targetAnnotationIds: ['a1', 'a2', 'a3'],
    });
    expect(result).toEqual({ success: true, jobId: 'job-1', totalCount: 3 });
    expect(jobRow().target_annotation_ids).toEqual(['a1', 'a2', 'a3']);
    expect(jobRow().status).toBe('pending');
  });

  it('未完了ジョブがあるときは事前検出で見つかる（BR-B03 の1段目）', async () => {
    seedJob({ target_annotation_ids: ['a1'], status: 'processing' });
    const active = await contentAnnotationSummaryJobService.findActiveJob(USER_ID);
    expect(active).toEqual({ jobId: 'job-1', processedCount: 0, totalCount: 1 });
  });

  it('ユニーク制約違反も already_running として返す（同時2クリック。BR-B03 の2段目）', async () => {
    seedJob({ target_annotation_ids: ['a1'], status: 'pending' });
    const result = await contentAnnotationSummaryJobService.createJob({
      userId: USER_ID,
      targetAnnotationIds: ['a2'],
    });
    expect(result).toEqual({ success: false, reason: 'already_running' });
  });

  it('completed のジョブは未完了扱いにしない', async () => {
    seedJob({ status: 'completed' });
    expect(await contentAnnotationSummaryJobService.findActiveJob(USER_ID)).toBeNull();
  });

  it('他人のジョブは進捗として返さない（Service Role 経路の user_id スコープ）', async () => {
    seedJob({ user_id: 'other-user', status: 'processing' });
    expect(await contentAnnotationSummaryJobService.findActiveJob(USER_ID)).toBeNull();
  });
});

describe('cron の処理順とカーソル（AC-B02 / AC-B14）', () => {
  it('processed_count の位置から再開し、既に処理した記事は再処理しない', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 6, processed_count: 3 });
    store.content_annotations.push(...ids.map(id => annotation(id)));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    const called = mocks.generateSummary.mock.calls.map(
      call => (call[0] as { target: { annotationId: string } }).target.annotationId
    );
    expect(called).toEqual(['a4', 'a5', 'a6']);
  });

  it('処理順は target_annotation_ids の配列順で、実行時に並べ替えない', async () => {
    const ids = ['a3', 'a1', 'a2'];
    seedJob({ target_annotation_ids: ids, total_count: 3 });
    store.content_annotations.push(...ids.map(id => annotation(id)));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    const called = mocks.generateSummary.mock.calls.map(
      call => (call[0] as { target: { annotationId: string } }).target.annotationId
    );
    expect(called).toEqual(['a3', 'a1', 'a2']);
  });

  it('進捗はチャンク境界でしか保存しない（3の倍数でのみ前進する）', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 6 });
    store.content_annotations.push(...ids.map(id => annotation(id)));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    const cursors = progressUpdates
      .filter(update => update.processed_count !== undefined)
      .map(update => update.processed_count);
    expect(cursors).toEqual([3, 6]);
  });

  it('チャンク内で完了順が入れ替わっても、カーソルは直近に完了したチャンクの末尾で止まる', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 12 });
    // 4つ目のチャンク（a10/a11/a12）の取得で異常終了させる
    store.content_annotations.push(...ids.slice(0, 9).map(id => annotation(id)));
    const failingIds = new Set(['a10', 'a11', 'a12']);
    const originalFrom = fakeClient.from;
    vi.spyOn(fakeClient, 'from').mockImplementation((table: keyof FakeStore) => {
      const builder = originalFrom.call(fakeClient, table);
      if (table !== 'content_annotations') return builder;
      return {
        ...builder,
        select: () => {
          const query = builder.select();
          const originalIn = query.in.bind(query);
          query.in = (column: string, values: unknown[]) => {
            if ((values as string[]).some(value => failingIds.has(value))) {
              throw new Error('simulated hard failure');
            }
            return originalIn(column, values);
          };
          return query;
        },
      };
    });

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    vi.mocked(fakeClient.from).mockRestore();

    // 直近に完了したチャンクの末尾（9件目）で止まる。着手済みで未完了だった記事は飛ばさない
    expect(jobRow().processed_count).toBe(9);
    expect(jobRow().succeeded_count).toBe(9);
    expect(jobRow().status).toBe('failed');
    // ジョブ単位の想定外例外は data.failed に計上する
    expect(result.failed).toBe(1);
  });

  it('再開時に再処理される記事は BR-B08 の再判定でスキップになり、要約を再生成しない', async () => {
    const ids = ['a10', 'a11', 'a12'];
    seedJob({ target_annotation_ids: ids, total_count: 3, processed_count: 0 });
    // a10 / a12 は前回の異常終了までに要約済み（8項目が埋まっている）
    store.content_annotations.push(
      annotation('a10', { main_kw: '埋まっている' }),
      annotation('a11'),
      annotation('a12', { main_kw: '埋まっている' })
    );

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    const called = mocks.generateSummary.mock.calls.map(
      call => (call[0] as { target: { annotationId: string } }).target.annotationId
    );
    expect(called).toEqual(['a11']);
    expect(jobRow().skipped_count).toBe(2);
    expect(jobRow().succeeded_count).toBe(1);
  });
});

describe('時間予算（AC-B03 / BR-B04）', () => {
  it('予算算出が null を返したら着手せず pending に戻す（経過秒の閾値比較で判定しない）', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 6 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    // 経過0秒でも null なら着手しない
    mocks.computeSummaryItemBudgetMs.mockReturnValue(null);

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(jobRow().status).toBe('pending');
    expect(result.carriedOver).toBe(true);
    expect(mocks.sendCompletionEmail).not.toHaveBeenCalled();
  });

  it('予算が尽きた時点までの件数は保存され、完了メールは送らない', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 6 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    mocks.computeSummaryItemBudgetMs.mockReturnValueOnce(BUDGET).mockReturnValue(null);

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().processed_count).toBe(3);
    expect(jobRow().succeeded_count).toBe(3);
    expect(jobRow().status).toBe('pending');
    expect(mocks.sendCompletionEmail).not.toHaveBeenCalled();
  });

  it('elapsedMs の起点はルートハンドラ開始時刻（掃き出しの所要も予算に含める）', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    const routeStartedAt = Date.now() - 600_000;

    await contentAnnotationSummaryJobService.runNextJob(routeStartedAt);

    const elapsed = mocks.computeSummaryItemBudgetMs.mock.calls[0]?.[0] as number;
    expect(elapsed).toBeGreaterThanOrEqual(600_000);
  });
});

describe('attempt_count は「連続無進捗回数」（BR-B09 / §13）', () => {
  it('前進があった起動の進捗保存で attempt_count を 0 に戻す', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    const progressSave = progressUpdates.find(update => update.processed_count !== undefined);
    expect(progressSave?.attempt_count).toBe(0);
  });

  it('予算切れで pending に戻る継続を5回繰り返しても failed にならず完走する', async () => {
    const ids = Array.from({ length: 15 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 15 });
    store.content_annotations.push(...ids.map(id => annotation(id)));

    // 1起動につき1チャンク（3件）だけ進める
    for (let run = 0; run < 5; run += 1) {
      mocks.computeSummaryItemBudgetMs.mockReset();
      mocks.computeSummaryItemBudgetMs.mockReturnValueOnce(BUDGET).mockReturnValue(null);
      await contentAnnotationSummaryJobService.runNextJob(Date.now());
      expect(jobRow().status).not.toBe('failed');
    }

    expect(jobRow().status).toBe('completed');
    expect(jobRow().processed_count).toBe(15);
    expect(jobRow().succeeded_count).toBe(15);
  });

  it('前進の無い claim が3回連続すると次の claim で failed に落ちる', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    mocks.computeSummaryItemBudgetMs.mockReturnValue(null);

    for (let run = 0; run < 3; run += 1) {
      await contentAnnotationSummaryJobService.runNextJob(Date.now());
    }
    expect(jobRow().attempt_count).toBe(3);
    expect(jobRow().status).toBe('pending');

    // 4回目の claim で回収され failed になる（アプリ層はこの行を見ない）
    await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(jobRow().status).toBe('failed');
  });
});

describe('実行直前の再判定（AC-B12 / AC-B13）', () => {
  it('起票後に8項目が埋まった記事は generateSummary を呼ばずスキップに計上する', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1', { persona: '手入力' }));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(mocks.saveSummary).not.toHaveBeenCalled();
    expect(jobRow().skipped_count).toBe(1);
  });

  it('WordPress 未連携の記事はスキップに計上する', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1', { wp_post_id: null, canonical_url: null }));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(jobRow().skipped_count).toBe(1);
  });

  it('他人の記事・削除済みの記事は NOT_OWNED として失敗に計上する', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1', { user_id: 'other-user' }));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(jobRow().failed_by_code).toEqual({ NOT_OWNED: 1 });
  });

  it('cron は cookieStore を渡さない（DB 保存トークン経路だけを使う）', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.generateSummary.mock.calls[0]?.[0]).toMatchObject({ cookieStore: undefined });
  });
});

describe('失敗の計上先（AC-B10 / AC-B16 / AC-B17）', () => {
  it('1件の失敗でジョブは止まらず、残りの処理は続行する', async () => {
    const ids = ['a1', 'a2', 'a3'];
    seedJob({ target_annotation_ids: ids, total_count: 3 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    mocks.generateSummary.mockImplementation(
      async ({ target }: { target: { annotationId: string } }) =>
        target.annotationId === 'a2'
          ? { success: false, code: 'SUMMARY_AI_FAILED' }
          : generated(target.annotationId)
    );

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().succeeded_count).toBe(2);
    expect(jobRow().failed_count).toBe(1);
    expect(jobRow().status).toBe('completed');
  });

  it('可否判定が「不可」なら本文取得失敗を SUMMARY_WP_REAUTH_REQUIRED に読み替える', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    mocks.canFetchWpPostContentLive.mockResolvedValue(false);
    mocks.generateSummary.mockResolvedValue({
      success: false,
      code: 'SUMMARY_CONTENT_FETCH_FAILED',
    });

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().failed_by_code).toEqual({ SUMMARY_WP_REAUTH_REQUIRED: 1 });
  });

  it('可否判定が「可」なら従来どおり SUMMARY_CONTENT_FETCH_FAILED に計上する', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    mocks.canFetchWpPostContentLive.mockResolvedValue(true);
    mocks.generateSummary.mockResolvedValue({
      success: false,
      code: 'SUMMARY_CONTENT_FETCH_FAILED',
    });

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().failed_by_code).toEqual({ SUMMARY_CONTENT_FETCH_FAILED: 1 });
  });

  it('可否判定は1起動につき1回だけ呼ぶ（記事ごとに呼ぶと最大1000回になる）', async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 6 });
    store.content_annotations.push(...ids.map(id => annotation(id)));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.canFetchWpPostContentLive).toHaveBeenCalledTimes(1);
  });

  it('429 は SUMMARY_AI_RATE_LIMITED として失敗に計上し、未実行へ回さない', async () => {
    const ids = ['a1', 'a2'];
    seedJob({ target_annotation_ids: ids, total_count: 2 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    mocks.generateSummary.mockResolvedValue({ success: false, code: 'SUMMARY_AI_RATE_LIMITED' });

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().failed_by_code).toEqual({ SUMMARY_AI_RATE_LIMITED: 2 });
    expect(jobRow().failed_by_code).not.toHaveProperty('SUMMARY_AI_FAILED');
    // 未実行に回さない＝カーソルは最後まで進み completed になる
    expect(jobRow().processed_count).toBe(2);
    expect(jobRow().status).toBe('completed');
    expect(result.carriedOver).toBe(false);
  });

  it('429 で待機しない（次の記事へすぐ進む）', async () => {
    const ids = Array.from({ length: 3 }, (_, index) => `a${index + 1}`);
    seedJob({ target_annotation_ids: ids, total_count: 3 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    mocks.generateSummary.mockResolvedValue({ success: false, code: 'SUMMARY_AI_RATE_LIMITED' });

    const startedAt = Date.now();
    await contentAnnotationSummaryJobService.runNextJob(startedAt);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('生成結果が8項目すべて空なら EMPTY_SUMMARY（成功に数えない）', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    mocks.generateSummary.mockResolvedValue({
      success: true,
      fields: { ...emptyFields, impressions: null },
      annotationId: 'a1',
      userId: USER_ID,
    });

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(jobRow().failed_by_code).toEqual({ EMPTY_SUMMARY: 1 });
    expect(jobRow().succeeded_count).toBe(0);
  });
});

describe('完了メール（AC-B04 / AC-B05 / AC-B06 / AC-B15）', () => {
  it('全件終わると同じ起動で1通送り、notified_at を打つ', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).toHaveBeenCalledTimes(1);
    // 冪等キーはジョブ ID
    expect(mocks.sendCompletionEmail.mock.calls[0]?.[3]).toBe('job-1');
    expect(jobRow().notified_at).not.toBeNull();
    expect(result.emailsSent).toBe(1);
  });

  it('送信済みのジョブへは再送しない（AC-B05）', async () => {
    seedJob({ status: 'completed', notified_at: '2026-09-04T01:00:00.000Z' });

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).not.toHaveBeenCalled();
  });

  it('メール未登録なら送らず、それでも notified_at を打つ（滞留させない。AC-B06）', async () => {
    store.users = [{ id: USER_ID, email: null }];
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).not.toHaveBeenCalled();
    expect(jobRow().status).toBe('completed');
    expect(jobRow().notified_at).not.toBeNull();
    expect(result.emailsSkipped).toBe(1);
  });

  it('送信に失敗したら notified_at を打たず、次回起動の掃き出しで再送する', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));
    mocks.sendCompletionEmail.mockResolvedValueOnce({ success: false, error: 'boom' });

    const first = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(jobRow().notified_at).toBeNull();
    expect(first.emailsFailed).toBe(1);
    // 送信失敗は運用が気づくべき失敗なので data.failed に含める
    expect(first.failed).toBe(1);

    const second = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(mocks.sendCompletionEmail).toHaveBeenCalledTimes(2);
    expect(second.emailsSent).toBe(1);
    expect(jobRow().notified_at).not.toBeNull();
  });

  it('claim RPC が failed に落とした行も掃き出しで通知する（AC-B15）', async () => {
    // アプリ層が一度も見ないまま failed になった行
    seedJob({ status: 'failed', notified_at: null, succeeded_count: 2, total_count: 5 });

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendCompletionEmail.mock.calls[0]?.[1]).toContain('途中で終了しました');
    expect(result.emailsSent).toBe(1);
    expect(jobRow().notified_at).not.toBeNull();
  });

  it('created_at が24時間より古い未通知ジョブは掃き出し対象に含めない', async () => {
    seedJob({
      status: 'completed',
      notified_at: null,
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).not.toHaveBeenCalled();
  });

  it('掃き出しは claim の前に走る（同じ起動で完了したジョブと二重送信しない）', async () => {
    seedJob({ target_annotation_ids: ['a1'], total_count: 1 });
    store.content_annotations.push(annotation('a1'));

    await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(mocks.sendCompletionEmail).toHaveBeenCalledTimes(1);
  });
});

describe('cron レスポンスの契約（§9）', () => {
  it('data.failed に記事単位の失敗を含めない（前例の合算式を写さない）', async () => {
    const ids = ['a1', 'a2', 'a3'];
    seedJob({ target_annotation_ids: ids, total_count: 3 });
    store.content_annotations.push(...ids.map(id => annotation(id)));
    mocks.generateSummary.mockResolvedValue({ success: false, code: 'SUMMARY_AI_FAILED' });

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(result.articlesFailed).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('skipped / skippedDueToLimit / stoppedReason のキーを載せない', async () => {
    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(result).not.toHaveProperty('skipped');
    expect(result).not.toHaveProperty('skippedDueToLimit');
    expect(result).not.toHaveProperty('stoppedReason');
    expect(result).toHaveProperty('carriedOver');
  });

  it('claim できるジョブが無い起動は空振りで success 相当（failed 0）', async () => {
    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(result.processedJobs).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('claim に失敗したら data.failed に計上する', async () => {
    rpcFailure = 'claim exploded';
    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());
    expect(result.failed).toBe(1);
  });

  it('記事単位の集計は articles* に載る', async () => {
    const ids = ['a1', 'a2', 'a3'];
    seedJob({ target_annotation_ids: ids, total_count: 3 });
    store.content_annotations.push(
      annotation('a1'),
      annotation('a2', { main_kw: '入力済み' }),
      annotation('a3', { user_id: 'other-user' })
    );

    const result = await contentAnnotationSummaryJobService.runNextJob(Date.now());

    expect(result.articlesSucceeded).toBe(1);
    expect(result.articlesSkipped).toBe(1);
    expect(result.articlesFailed).toBe(1);
  });
});
