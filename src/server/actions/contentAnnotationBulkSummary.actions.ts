'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import { MAX_BULK_SUMMARY_TARGETS } from '@/lib/constants';
import { canWriteGa4 } from '@/server/lib/ga4-permissions';
import { normalizeBulkTargetIds } from '@/server/lib/gsc-bulk-evaluation';
import { isWithAuthEmailLinkConflict, withAuth } from '@/server/middleware/withAuth.middleware';
import { analyticsContentService } from '@/server/services/analyticsContentService';
import { contentAnnotationSummaryJobService } from '@/server/services/contentAnnotationSummaryJobService';

/**
 * AI 要約一括実行の Server Action（**ジョブ起票**）。
 * 正本: docs/plans/content-annotation-bulk-summary-background-spec.md
 *
 * 2026-09-04 に同期実行からバックグラウンド実行へ差し替えた。この Action がするのは
 * 「対象 ID を解決してジョブを1件作る」ところまでで（BR-B01 / BR-B02）、要約の生成は
 * cron（`/api/cron/content-annotation-summary`）が行う。結果は完了メールと進捗表示で受け取る。
 *
 * **対象の解決は起票時に1回だけ行う**（BR-B02）。母集団は `updated_at` 降順・上限1000件で
 * 解決されるため、実行のたびに再解決すると対象が入れ替わって前進しない。
 * ただし固定するのは「対象集合」だけで、「要約してよいか」は cron が実行直前に再判定する（BR-B08）。
 */

const bulkSummaryInputSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ids'),
    contentAnnotationIds: z.array(z.uuidv4()),
  }),
  z.object({
    mode: z.literal('all'),
    /** 全選択したまま個別解除した記事（評価親 BR-07「全選択後の個別解除」）。母集団から差し引く */
    excludedIds: z.array(z.uuidv4()).optional(),
  }),
]);

export interface EnqueueBulkSummaryResult {
  jobId: string;
  /** 起票時に固定した対象ID数。「要約される見込み件数」ではない（§6 分母の定義） */
  totalCount: number;
}

export async function summarizeContentAnnotationsBulk(
  params: unknown
): Promise<ServerActionResult<EnqueueBulkSummaryResult>> {
  const parsed = bulkSummaryInputSchema.safeParse(params);
  if (!parsed.success) {
    console.error(
      '[content-annotation-bulk-summary] validation failed:',
      z.prettifyError(parsed.error)
    );
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }
  const input = parsed.data;

  try {
    const authResult = await withAuth(async ({ userId, userDetails }) => {
      // UI だけでなくサーバー側でも認可を検証する（CLAUDE.md Core Rules。AC-B09）
      if (!canWriteGa4({ role: userDetails?.role ?? null })) {
        console.error('[content-annotation-bulk-summary] forbidden role:', {
          role: userDetails?.role ?? null,
        });
        return { success: false as const, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
      }

      // ---- 対象 ID の解決（起票時に1回だけ。BR-B02）-------------------------
      let targetIds: string[];
      if (input.mode === 'ids') {
        targetIds = normalizeBulkTargetIds(input.contentAnnotationIds);
        if (targetIds.length === 0) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED,
          };
        }
        if (targetIds.length > MAX_BULK_SUMMARY_TARGETS) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_LIMIT_EXCEEDED,
          };
        }
      } else {
        const population = await analyticsContentService.resolveAllAnnotationIds(
          userId,
          MAX_BULK_SUMMARY_TARGETS
        );
        if (!population) {
          console.error('[content-annotation-bulk-summary] population resolve failed');
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH,
          };
        }
        // 突合（R-002）は除外を差し引く前の母集団に対して行う。除外は利用者の意思なので
        // 「取得できた件数が想定と食い違う」障害とは区別する
        const expectedCount = Math.min(population.total, MAX_BULK_SUMMARY_TARGETS);
        if (population.ids.length !== expectedCount) {
          console.error('[content-annotation-bulk-summary] population count mismatch:', {
            resolved: population.ids.length,
            expected: expectedCount,
            total: population.total,
          });
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH,
          };
        }
        const excluded = new Set(normalizeBulkTargetIds(input.excludedIds ?? []));
        targetIds = population.ids.filter(id => !excluded.has(id));
        if (targetIds.length === 0) {
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED,
          };
        }
      }

      // ---- 二重起票の検出は2段構え（BR-B03 / AC-B07）------------------------
      // 事前 SELECT で見つかった場合も、同時2クリックがユニーク制約違反になった場合も、
      // **同じ SUMMARY_BULK_ALREADY_RUNNING を返す**。汎用の SUMMARY_BULK_FAILED に
      // 落とすと AC-B07 の期待表示と食い違う
      const activeJob = await contentAnnotationSummaryJobService.findActiveJob(userId);
      if (activeJob) {
        return {
          success: false as const,
          error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_ALREADY_RUNNING,
        };
      }

      const created = await contentAnnotationSummaryJobService.createJob({
        userId,
        targetAnnotationIds: targetIds,
      });
      if (!created.success) {
        return {
          success: false as const,
          error:
            created.reason === 'already_running'
              ? ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_ALREADY_RUNNING
              : ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED,
        };
      }

      revalidatePath('/analytics');
      return {
        success: true as const,
        data: { jobId: created.jobId, totalCount: created.totalCount },
      };
    });

    if (isWithAuthEmailLinkConflict(authResult)) {
      return { success: false, error: authResult.error, emailLinkConflict: true };
    }
    return authResult;
  } catch (error) {
    console.error('[content-annotation-bulk-summary] enqueue failed:', error);
    return { success: false, error: ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED };
  }
}
