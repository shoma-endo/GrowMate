import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  metric: null as { position: number | string | null; date: string } | null,
  claimResult: { data: null, error: null } as {
    data: { id: string } | null;
    error: null | { message: string };
  },
  claimFilters: [] as Array<[string, unknown]>,
  historyInsert: vi.fn(),
  importMetrics: vi.fn(),
}));

vi.mock('@/server/services/gscImportService', () => ({
  gscImportService: { importMetrics: mocks.importMetrics },
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return {
        from: (table: string) => {
          let operation: 'select' | 'update' | 'insert' = 'select';
          const query = {
            select: vi.fn(() => query),
            eq: vi.fn((column: string, value: unknown) => {
              if (operation === 'update') mocks.claimFilters.push([column, value]);
              return query;
            }),
            // .eq(col, null) は SQL で常に偽になり NULL 行を永久に確保できないため、
            // .is と区別して記録する（`is:` 接頭辞）
            is: vi.fn((column: string, value: unknown) => {
              if (operation === 'update') mocks.claimFilters.push([`is:${column}`, value]);
              return query;
            }),
            not: vi.fn(() => query),
            order: vi.fn(() => query),
            limit: vi.fn(() => query),
            update: vi.fn(() => {
              operation = 'update';
              return query;
            }),
            insert: vi.fn((value: unknown) => {
              operation = 'insert';
              if (table === 'gsc_article_evaluation_history') mocks.historyInsert(value);
              return query;
            }),
            maybeSingle: vi.fn(() => {
              if (operation === 'update') return Promise.resolve(mocks.claimResult);
              if (table === 'gsc_page_metrics') {
                return Promise.resolve({ data: mocks.metric, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            }),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          };
          return query;
        },
      };
    }
  },
}));

import { gscEvaluationService } from '@/server/services/gscEvaluationService';

const evaluation = (lastSeen: number | null, lastEvaluatedOn: string | null) => ({
  id: 'evaluation-1',
  user_id: 'user-1',
  content_annotation_id: 'annotation-1',
  property_uri: 'sc-domain:example.com',
  base_evaluation_date: '2026-01-01',
  cycle_days: 1,
  evaluation_hour: 0,
  status: 'active',
  last_seen_position: lastSeen,
  last_evaluated_on: lastEvaluatedOn,
});

describe('gscEvaluationService evaluation claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.metric = { position: 20, date: '2026-09-24' };
    mocks.claimResult = { data: null, error: null };
    mocks.claimFilters.length = 0;
    mocks.importMetrics.mockResolvedValue({ pageMetricsHitLimit: false });
  });

  it.each([
    ['baseline', evaluation(null, null)],
    ['successful evaluation', evaluation(25, '2026-09-20')],
  ])('%s claim loser does not insert history and uses the extracted NULL/value predicate', async (_name, row) => {
    const result = await gscEvaluationService.runDueEvaluationsForUser('user-1', {
      force: true,
      evaluations: [row],
      nowJst: new Date('2026-09-24T03:00:00.000Z'),
    });

    expect(result.skippedClaimLost).toBe(1);
    expect(result.skippedSystemError).toBe(0);
    expect(mocks.historyInsert).not.toHaveBeenCalled();
    expect(mocks.claimFilters).toContainEqual(['user_id', 'user-1']);
    expect(mocks.claimFilters).toContainEqual(
      row.last_evaluated_on === null
        ? ['is:last_evaluated_on', null]
        : ['last_evaluated_on', row.last_evaluated_on]
    );
  });

  it('NULL の行でも確保に勝った起動は評価履歴を1件作る', async () => {
    mocks.claimResult = { data: { id: 'evaluation-1' }, error: null };

    const result = await gscEvaluationService.runDueEvaluationsForUser('user-1', {
      force: true,
      evaluations: [evaluation(25, null)],
      nowJst: new Date('2026-09-24T03:00:00.000Z'),
    });

    expect(result.skippedClaimLost).toBe(0);
    expect(mocks.claimFilters).toContainEqual(['is:last_evaluated_on', null]);
    expect(mocks.historyInsert).toHaveBeenCalledTimes(1);
  });

  it('no_metrics claim loser does not insert an error history row', async () => {
    mocks.metric = null;

    const result = await gscEvaluationService.runDueEvaluationsForUser('user-1', {
      force: true,
      evaluations: [evaluation(25, '2026-09-20')],
      nowJst: new Date('2026-09-24T03:00:00.000Z'),
    });

    expect(result.skippedClaimLost).toBe(1);
    expect(result.skippedSystemError).toBe(0);
    expect(mocks.historyInsert).not.toHaveBeenCalled();
  });

  it('position null claim loser does not insert an error history row', async () => {
    mocks.metric = { position: 'invalid', date: '2026-09-24' };

    const result = await gscEvaluationService.runDueEvaluationsForUser('user-1', {
      force: true,
      evaluations: [evaluation(25, '2026-09-20')],
      nowJst: new Date('2026-09-24T03:00:00.000Z'),
    });

    expect(result.skippedClaimLost).toBe(1);
    expect(result.skippedSystemError).toBe(0);
    expect(mocks.historyInsert).not.toHaveBeenCalled();
  });
});
