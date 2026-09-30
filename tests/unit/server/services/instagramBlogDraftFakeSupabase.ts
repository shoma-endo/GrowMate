type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'lt' | 'in' | 'is' | 'gte'; column: string; value: unknown };
type Operation = 'select' | 'insert' | 'update' | 'delete' | 'upsert';
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

/** 次に table への operation が実行されたとき、1回だけ error を返す */
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

const fakeClient = {
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
