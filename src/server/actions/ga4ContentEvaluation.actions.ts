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
    return {
      success: true,
      data: await ga4ContentEvaluationService.run({ userId, ...parsed.data }),
    };
  } catch (error) {
    console.error('[ga4ContentEvaluation.actions] run failed', { code: error instanceof Error ? error.name : 'unknown' });
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'needs_reauth') {
      return { success: false, error: ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED };
    }
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
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'needs_reauth') {
      return { success: false, error: ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED };
    }
    return { success: false, error: ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED };
  }
}
