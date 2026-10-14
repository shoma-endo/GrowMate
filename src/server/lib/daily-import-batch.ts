export const DAILY_IMPORT_TIME_BUDGET_MS = 700_000;

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

  for (const userId of userIds) {
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
