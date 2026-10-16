import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_IMPORT_TIME_BUDGET_MS, rotateForDay, runDailyImportBatch } from '@/server/lib/daily-import-batch';

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
  it.each([
    ['0日目', 0, ['a', 'b', 'c']],
    ['1日目', 1, ['b', 'c', 'a']],
    ['3日目（人数で一周）', 3, ['a', 'b', 'c']],
    ['4日目', 4, ['b', 'c', 'a']],
  ] as const)('処理順の先頭を日ごとにずらす: %s', (_label, day, expected) => {
    const startedAt = day * 24 * 60 * 60 * 1000 + 19 * 60 * 60 * 1000;
    expect(rotateForDay(['a', 'b', 'c'], startedAt)).toEqual(expected);
  });

  it('1日1人しか処理できずに打ち切られても、翌日は前日と別のユーザーから処理が始まる', async () => {
    const day = 24 * 60 * 60 * 1000;
    const runDay = async (startedAt: number) => {
      vi.spyOn(Date, 'now').mockReturnValueOnce(startedAt).mockReturnValue(startedAt + DAILY_IMPORT_TIME_BUDGET_MS);
      const importUser = vi.fn(async (_userId: string) => ({ ok: true as const }));
      await runDailyImportBatch({ source: 'gsc', userIds: ['one', 'two'], startedAt, importUser });
      vi.restoreAllMocks();
      return importUser.mock.calls.map(([userId]) => userId);
    };

    expect(await runDay(0)).toEqual(['one']);
    expect(await runDay(day)).toEqual(['two']);
  });
  it('各ユーザーの取込に、バッチ開始＋時間予算を締め切りとして渡す（予算は取込元ごとに指定できる）', async () => {
    const importUser = vi.fn(async (_userId: string, _deadlineAt: number) => ({ ok: true as const }));
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await runDailyImportBatch({ source: 'wordpress', userIds: ['one'], startedAt: 5000, importUser, timeBudgetMs: 1_700_000 });
    await runDailyImportBatch({ source: 'gsc', userIds: ['one'], startedAt: 5000, importUser });

    expect(importUser.mock.calls).toEqual([
      ['one', 5000 + 1_700_000],
      ['one', 5000 + DAILY_IMPORT_TIME_BUDGET_MS],
    ]);
  });

  it('時間予算を指定すると、その予算で残りのユーザーを打ち切る', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_500_000);
    const importUser = vi.fn(async (_userId: string, _deadlineAt: number) => ({ ok: true as const }));
    const result = await runDailyImportBatch({
      source: 'wordpress', userIds: ['one', 'two', 'three'], startedAt: 0, importUser, timeBudgetMs: 1_700_000,
    });

    // 共通の700秒なら2人目で打ち切られるが、1700秒の予算では続ける
    expect(importUser.mock.calls.map(([userId, deadlineAt]) => [userId, deadlineAt])).toEqual([
      ['one', 1_700_000], ['two', 1_700_000], ['three', 1_700_000],
    ]);
    expect(result.skippedDueToLimit).toBe(0);
  });
});
