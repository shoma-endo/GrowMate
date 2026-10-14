export const DAILY_IMPORT_TIME_BUDGET_MS = 700_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 処理順の先頭を日ごとに1人ずつずらす。固定順のままだと、時間予算で打ち切られる日が続いたとき
 * 末尾のユーザーが毎日同じ位置で切られ、永久に取り込まれない。
 * 上限：人数 n なら、どのユーザーも n 日に1回は先頭になる。毎日全員を処理し切れない状態が続くなら、
 * 起動回数を増やす（仕様 R-004 / OPEN-001）。
 */
export function rotateForDay<T>(items: T[], startedAt: number): T[] {
  if (items.length === 0) return items;
  const offset = Math.floor(startedAt / DAY_MS) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export interface DailyImportBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  skippedDueToLimit: number;
}

export async function runDailyImportBatch({
  source,
  userIds,
  startedAt,
  importUser,
}: {
  source: 'gsc' | 'ga4' | 'wordpress';
  userIds: string[];
  startedAt: number;
  importUser: (userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}): Promise<DailyImportBatchResult> {
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;

  for (const userId of rotateForDay(userIds, startedAt)) {
    if (Date.now() - startedAt >= DAILY_IMPORT_TIME_BUDGET_MS) break;
    attempted += 1;
    try {
      const result = await importUser(userId);
      if (result.ok) {
        succeeded += 1;
      } else {
        failed += 1;
        console.error(`[daily-import:${source}] user failed`, { userId, reason: result.reason });
      }
    } catch (error) {
      failed += 1;
      console.error(`[daily-import:${source}] user failed`, {
        userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: userIds.length,
    succeeded,
    failed,
    skippedDueToLimit: userIds.length - attempted,
  };
}
