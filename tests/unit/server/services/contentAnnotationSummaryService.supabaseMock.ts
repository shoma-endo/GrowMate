import { vi } from 'vitest';

/**
 * `contentAnnotationSummaryService` の2つのテストファイルが共有する SupabaseService のモック。
 * チェーン（select / update / eq）は同じクエリを返し、終端の `maybeSingle` だけを各テストで仕込む。
 * vi.mock のファクトリからは動的 import で参照する（静的 import はホイストされた factory から見えない）。
 */
export const summaryDb = {
  from: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
};

export class FakeSupabaseService {
  getClient() {
    const query = {
      select: summaryDb.select,
      update: summaryDb.update,
      eq: summaryDb.eq,
      maybeSingle: summaryDb.maybeSingle,
    };
    summaryDb.select.mockReturnValue(query);
    summaryDb.update.mockReturnValue(query);
    summaryDb.eq.mockReturnValue(query);
    summaryDb.from.mockReturnValue(query);
    return { from: summaryDb.from };
  }
}
