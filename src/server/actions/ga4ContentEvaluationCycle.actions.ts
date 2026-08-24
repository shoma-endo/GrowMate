'use server';

import { revalidatePath } from 'next/cache';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { canAccessGa4, canWriteGa4 } from '@/server/lib/ga4-permissions';
import {
  ga4ContentEvaluationCycleAnnotationIdSchema,
  ga4ContentEvaluationCycleRegisterInputSchema,
  ga4ContentEvaluationCycleUpdateInputSchema,
} from '@/server/schemas/ga4ContentEvaluationCycle.schema';
import { ga4ContentEvaluationCycleService } from '@/server/services/ga4ContentEvaluationCycleService';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';

async function getAuthorizedUserId(write: boolean): Promise<string | null> {
  const auth = await authMiddleware();
  const role = auth.userDetails?.role ?? null;
  if (auth.error || !auth.userId) return null;
  if (write ? !canWriteGa4({ role }) : !canAccessGa4({ role })) return null;
  return auth.userId;
}

function mapCycleError(error: unknown, fallback: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 'article_not_found') return ERROR_MESSAGES.GA4.CYCLE_ARTICLE_NOT_FOUND;
  if (code === 'cycle_already_registered') return ERROR_MESSAGES.GA4.CYCLE_ALREADY_REGISTERED;
  if (code === 'cycle_not_found') return ERROR_MESSAGES.GA4.CYCLE_NOT_FOUND;
  return fallback;
}

export async function fetchGa4ContentEvaluationCycle(
  annotationId: string
): Promise<ServerActionResult<Ga4ContentEvaluationCycleView | null>> {
  const userId = await getAuthorizedUserId(false);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  if (!ga4ContentEvaluationCycleAnnotationIdSchema.safeParse(annotationId).success) {
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }
  try {
    return { success: true, data: await ga4ContentEvaluationCycleService.fetchCycle(userId, annotationId) };
  } catch (error) {
    console.error('[ga4ContentEvaluationCycle.actions] fetch failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: ERROR_MESSAGES.GA4.CYCLE_FETCH_FAILED };
  }
}

export async function registerGa4ContentEvaluationCycle(
  input: unknown
): Promise<ServerActionResult<Ga4ContentEvaluationCycleView>> {
  const userId = await getAuthorizedUserId(true);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  const parsed = ga4ContentEvaluationCycleRegisterInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  try {
    const data = await ga4ContentEvaluationCycleService.registerCycle(userId, parsed.data);
    revalidatePath('/analytics/[annotationId]', 'page');
    return { success: true, data };
  } catch (error) {
    console.error('[ga4ContentEvaluationCycle.actions] register failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: mapCycleError(error, ERROR_MESSAGES.GA4.CYCLE_REGISTER_FAILED) };
  }
}

export async function updateGa4ContentEvaluationCycle(
  input: unknown
): Promise<ServerActionResult<Ga4ContentEvaluationCycleView>> {
  const userId = await getAuthorizedUserId(true);
  if (!userId) return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  const parsed = ga4ContentEvaluationCycleUpdateInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  try {
    const data = await ga4ContentEvaluationCycleService.updateCycle(userId, parsed.data);
    revalidatePath('/analytics/[annotationId]', 'page');
    return { success: true, data };
  } catch (error) {
    console.error('[ga4ContentEvaluationCycle.actions] update failed', { code: error instanceof Error ? error.name : 'unknown' });
    return { success: false, error: mapCycleError(error, ERROR_MESSAGES.GA4.CYCLE_UPDATE_FAILED) };
  }
}
