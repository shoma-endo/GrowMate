'use server';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { canAccessGa4, canWriteGa4 } from '@/server/lib/ga4-permissions';
import {
  ga4ContentEvaluationAnnotationIdSchema,
  ga4ContentEvaluationInputSchema,
} from '@/server/schemas/ga4ContentEvaluation.schema';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import { ga4ContentEvaluationBatchService } from '@/server/services/ga4ContentEvaluationBatchService';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

async function getAuthorizedUserId(write: boolean): Promise<string | null> {
  const auth = await authMiddleware();
  const role = auth.userDetails?.role ?? null;
  if (auth.error || !auth.userId) return null;
  if (write ? !canWriteGa4({ role }) : !canAccessGa4({ role })) return null;
  return auth.userId;
}

export async function fetchGa4ContentEvaluation(
  annotationId: string
): Promise<ServerActionResult<Ga4ContentEvaluationView>> {
  const userId = await getAuthorizedUserId(false);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  if (!ga4ContentEvaluationAnnotationIdSchema.safeParse(annotationId).success) {
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }
  try {
    return { success: true, data: await ga4ContentEvaluationService.fetchEvaluation(userId, annotationId) };
  } catch (error) {
    console.error('[ga4ContentEvaluation.actions] fetch failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: ERROR_MESSAGES.GA4.EVALUATION_FETCH_FAILED };
  }
}

export async function runGa4ContentEvaluation(
  input: unknown
): Promise<ServerActionResult<Ga4ContentEvaluationView>> {
  const userId = await getAuthorizedUserId(true);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  const parsed = ga4ContentEvaluationInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  try {
    const view = await ga4ContentEvaluationService.run({ userId, ...parsed.data });
    // 手動実行でもGA4側のクールダウンを進める（2026-08-26）。進めないと概要タブとコンテンツ評価タブで
    // 「次回評価予定」がズレ、直後の毎時Cronが同じ記事を再評価してLLMを二重に呼ぶ。
    //
    // 進めるのは実際にスコアが算出できたときだけ（バッチの shouldAdvanceCooldown と同じ考え方）。
    // insufficient_data / import_failed / evaluation_failed で進めると、自動リトライが1サイクル
    // （既定30日）先まで来なくなる。narrative_failed はスコアが確定しているので進める。
    // 内部で例外を握り潰す設計なので、失敗しても評価結果はそのまま返る
    const scored = view.displayStatus === 'evaluated' || view.displayStatus === 'narrative_failed';
    if (scored) {
      await ga4ContentEvaluationBatchService.advanceCooldownForManualRun(
        userId,
        parsed.data.annotationId,
        view.history[0]?.contentScore ?? null
      );
    }
    return { success: true, data: view };
  } catch (error) {
    console.error('[ga4ContentEvaluation.actions] run failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED };
  }
}

export async function retryGa4ContentEvaluationNarrative(
  annotationId: string
): Promise<ServerActionResult<Ga4ContentEvaluationView>> {
  const userId = await getAuthorizedUserId(true);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  if (!ga4ContentEvaluationAnnotationIdSchema.safeParse(annotationId).success) {
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }
  try {
    return {
      success: true,
      data: await ga4ContentEvaluationService.retryNarrative(userId, annotationId),
    };
  } catch (error) {
    console.error('[ga4ContentEvaluation.actions] narrative retry failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED };
  }
}
