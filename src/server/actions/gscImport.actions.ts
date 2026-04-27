'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { gscImportService } from '@/server/services/gscImportService';
import { gscEvaluationService } from '@/server/services/gscEvaluationService';
import { splitRangeByDays, aggregateImportResults } from '@/server/lib/gsc-import-utils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

interface GscImportParams {
  startDate: string;
  endDate: string;
  searchType?: 'web' | 'image' | 'news';
  maxRows?: number;
  runEvaluation?: boolean;
}

export async function runGscImport(params: GscImportParams) {
  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) return linkConflict;
    if (authResult.error || !authResult.userId) {
      return { success: false, error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const role = authResult.userDetails?.role ?? null;
    if (!role || role === 'unavailable') {
      return { success: false, error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED };
    }

    const { startDate, endDate, searchType = 'web', maxRows = 1000, runEvaluation = true } = params;

    if (!startDate || !endDate) {
      return { success: false, error: ERROR_MESSAGES.GSC.DATE_RANGE_REQUIRED };
    }

    if (typeof maxRows !== 'number' || maxRows < 1 || maxRows > 25000) {
      return { success: false, error: ERROR_MESSAGES.GSC.MAX_ROWS_INVALID };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { success: false, error: ERROR_MESSAGES.GSC.INVALID_DATE_FORMAT };
    }
    if (start > end) {
      return { success: false, error: ERROR_MESSAGES.GSC.START_DATE_AFTER_END };
    }
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 365) {
      return { success: false, error: ERROR_MESSAGES.GSC.PERIOD_TOO_LONG };
    }

    const importOnce = async (segmentStart: string, segmentEnd: string) =>
      gscImportService.importMetrics(authResult.userId, {
        startDate: segmentStart,
        endDate: segmentEnd,
        searchType,
        maxRows,
      });

    const summary = await importWithSplit(importOnce, startDate, endDate, 30);

    // 評価実行（オプション）
    if (runEvaluation) {
      const evalSummary = await gscEvaluationService.runDueEvaluationsForUser(authResult.userId);
      summary.evaluated = evalSummary.processed;
    }

    revalidatePath('/gsc-import');
    return { success: true, data: summary };
  } catch (error) {
    console.error('[gsc-import] import failed', error);
    const message = error instanceof Error ? error.message : ERROR_MESSAGES.GSC.IMPORT_FAILED;
    return { success: false, error: message };
  }
}

const importWithSplit = async (
  importOnce: (
    start: string,
    end: string
  ) => Promise<{
    totalFetched: number;
    upserted: number;
    skipped: number;
    unmatched: number;
    evaluated: number;
    querySummary?: {
      fetchedRows: number;
      keptRows: number;
      dedupedRows: number;
      fetchErrorPages: number;
      skipped: {
        missingKeys: number;
        invalidUrl: number;
        emptyQuery: number;
        zeroMetrics: number;
      };
      hitLimit: boolean;
    };
  }>,
  startDate: string,
  endDate: string,
  segmentDays: number
) => {
  const ranges = splitRangeByDays(startDate, endDate, segmentDays);
  const results: Awaited<ReturnType<typeof importOnce>>[] = [];

  for (const range of ranges) {
    const result = await importOnce(range.start, range.end);
    results.push(result);
  }

  return aggregateImportResults(results, ranges.length);
};
