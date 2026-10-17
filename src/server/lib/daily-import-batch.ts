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
  timeBudgetMs = DAILY_IMPORT_TIME_BUDGET_MS,
  deferredUserIds = [],
}: {
  source: 'gsc' | 'ga4' | 'wordpress';
  userIds: string[];
  /**
   * userIds の後に回すユーザー（WordPress の初回全件取込など、1人で時間予算の多くを使うもの）。
   * 1人あたりの上限が無いので、先に処理すると後ろのユーザーが時間予算の打ち切りで取り込まれなくなる
   */
  deferredUserIds?: string[];
  startedAt: number;
  /** deadlineAt（epoch ms）を受け取る取込は、それを超えないように途中で打ち切る */
  importUser: (userId: string, deadlineAt: number) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** route の maxDuration より、打ち切り後の後始末（結果の記録・ログ）の分だけ短くする */
  timeBudgetMs?: number;
}): Promise<DailyImportBatchResult> {
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;

  const runGroup = async (ids: string[], budgetMs: number) => {
    for (const userId of rotateForDay(ids, startedAt)) {
      if (Date.now() - startedAt >= budgetMs) return;
      attempted += 1;
      try {
        const result = await importUser(userId, startedAt + budgetMs);
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
  };

  // 後回しのユーザーがいる日は、通常のユーザーに時間予算の半分までしか使わせない。
  // 通常のユーザーだけで予算を使い切る日が続くと、後回しのユーザーが一度も処理されなくなるため
  const total = userIds.length + deferredUserIds.length;
  await runGroup(userIds, deferredUserIds.length > 0 ? timeBudgetMs / 2 : timeBudgetMs);
  await runGroup(deferredUserIds, timeBudgetMs);

  return {
    total,
    succeeded,
    failed,
    skippedDueToLimit: total - attempted,
  };
}
