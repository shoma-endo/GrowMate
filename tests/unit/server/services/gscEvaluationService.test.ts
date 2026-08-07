import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lte: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        lte: mocks.lte,
      };
      return { from: vi.fn(() => query) };
    }
  },
}));

vi.mock('@/server/services/gscImportService', () => ({
  gscImportService: { importMetrics: vi.fn() },
}));

import { gscEvaluationService } from '@/server/services/gscEvaluationService';

describe('gscEvaluationService.runAllDueEvaluations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('完了ログの主要カウンタをユーザー単位に統一する', async () => {
    mocks.lte.mockResolvedValue({
      data: [
        {
          id: 'evaluation-id',
          user_id: 'user-id',
          content_annotation_id: 'annotation-id',
          property_uri: 'sc-domain:example.com',
          base_evaluation_date: '2020-01-01',
          cycle_days: 1,
          evaluation_hour: 0,
          status: 'active',
          next_evaluation_date: '2020-01-02',
        },
      ],
      error: null,
    });
    vi.spyOn(gscEvaluationService, 'runDueEvaluationsForUser').mockResolvedValue({
      processed: 0,
      improved: 0,
      advanced: 0,
      baselineInitialized: 0,
      skippedNoMetrics: 0,
      skippedImportFailed: 0,
      skippedSystemError: 3,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await gscEvaluationService.runAllDueEvaluations();
    const completedLog = info.mock.calls
      .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find(log => log.event === 'batch_completed');

    expect(result).toMatchObject({
      usersAttempted: 1,
      usersProcessed: 1,
      totalSystemError: 3,
    });
    expect(completedLog).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('DB取得失敗をbatch_failedとして記録して再throwする', async () => {
    mocks.lte.mockResolvedValue({
      data: null,
      error: { message: '評価対象の取得に失敗しました' },
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(gscEvaluationService.runAllDueEvaluations()).rejects.toThrow(
      '評価対象の取得に失敗しました'
    );
    const events = [
      ...info.mock.calls.map(call => JSON.parse(String(call[0])) as Record<string, unknown>),
      ...error.mock.calls.map(call => JSON.parse(String(call[0])) as Record<string, unknown>),
    ];

    expect(events.map(event => event.event)).toContain('batch_started');
    expect(events.map(event => event.event)).toContain('batch_failed');
    expect(events.map(event => event.event)).not.toContain('batch_completed');
  });

  it('未試行ユーザーを含む候補総数を完了ログのtotalへ記録する', async () => {
    mocks.lte.mockResolvedValue({
      data: Array.from({ length: 11 }, (_, index) => ({
        id: `evaluation-${index}`,
        user_id: `user-${index}`,
        content_annotation_id: `annotation-${index}`,
        property_uri: 'sc-domain:example.com',
        base_evaluation_date: '2020-01-01',
        cycle_days: 1,
        evaluation_hour: 0,
        status: 'active',
        next_evaluation_date: '2020-01-02',
      })),
      error: null,
    });
    vi.spyOn(gscEvaluationService, 'runDueEvaluationsForUser').mockResolvedValue({
      processed: 1,
      improved: 0,
      advanced: 0,
      baselineInitialized: 0,
      skippedNoMetrics: 0,
      skippedImportFailed: 0,
      skippedSystemError: 0,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await gscEvaluationService.runAllDueEvaluations();
    const completedLog = info.mock.calls
      .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find(log => log.event === 'batch_completed');

    expect(result).toMatchObject({
      usersAttempted: 10,
      usersProcessed: 10,
      usersSkippedDueToLimit: 1,
      stoppedReason: 'max_users',
    });
    expect(completedLog).toMatchObject({
      total: 11,
      succeeded: 10,
      failed: 0,
      skipped: 1,
    });
  });
});
