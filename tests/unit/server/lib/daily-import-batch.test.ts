import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_IMPORT_TIME_BUDGET_MS, runDailyImportBatch } from '@/server/lib/daily-import-batch';

describe('runDailyImportBatch (auto-daily-imports-spec §6)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('人数で打ち切らず、ユーザー失敗後も続ける', async () => {
    const importUser = vi.fn(async (userId: string) =>
      userId === 'user-5' ? { ok: false as const, reason: 'failed' } : { ok: true as const }
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runDailyImportBatch({
      source: 'gsc',
      userIds: Array.from({ length: 11 }, (_, index) => `user-${index + 1}`),
      startedAt: Date.now(),
      importUser,
    });

    expect(importUser).toHaveBeenCalledTimes(11);
    expect(result).toEqual({ total: 11, succeeded: 10, failed: 1, skippedDueToLimit: 0 });
    expect(console.error).toHaveBeenCalledWith('[daily-import:gsc] user failed', {
      userId: 'user-5', reason: 'failed',
    });
  });

  it('時間予算を超えた時点で残り全員をスキップする', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000 + DAILY_IMPORT_TIME_BUDGET_MS);
    const importUser = vi.fn(async () => ({ ok: true as const }));
    const result = await runDailyImportBatch({
      source: 'ga4', userIds: ['one', 'two', 'three'], startedAt: 1000, importUser,
    });

    expect(now).toHaveBeenCalledTimes(2);
    expect(importUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ total: 3, succeeded: 1, failed: 0, skippedDueToLimit: 2 });
  });
});
