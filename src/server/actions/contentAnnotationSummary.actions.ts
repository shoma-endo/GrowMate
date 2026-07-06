'use server';

import { withAuth, isWithAuthEmailLinkConflict } from '@/server/middleware/withAuth.middleware';
import {
  getContentAnnotationSummaryErrorMessage,
  contentAnnotationSummaryService,
} from '@/server/services/contentAnnotationSummaryService';
import {
  getContentAnnotationBySession,
  upsertContentAnnotationBySession,
} from '@/server/actions/wordpress.actions';
import { summarizeContentAnnotationSchema } from '@/server/schemas/contentAnnotationSummary.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { AnnotationRecord } from '@/types/annotation';
import { isEmailLinkConflictResult } from '@/lib/auth/emailLinkConflictClient';

type SummarizeContentAnnotationResult =
  | { success: true; data: AnnotationRecord }
  | { success: false; error: string; emailLinkConflict?: true };

export async function summarizeContentAnnotation(
  sessionId: string
): Promise<SummarizeContentAnnotationResult> {
  const parsed = summarizeContentAnnotationSchema.safeParse({ sessionId });
  if (!parsed.success) {
    return {
      success: false,
      error: '入力データが不正です。ページを更新してから再度お試しください。',
    };
  }

  const authResult = await withAuth(async ({ userId, cookieStore }) => {
    const summaryResult = await contentAnnotationSummaryService.generateSummary({
      sessionId: parsed.data.sessionId,
      executorUserId: userId,
      cookieStore,
    });

    if (!summaryResult.success) {
      return {
        success: false as const,
        error: getContentAnnotationSummaryErrorMessage(summaryResult.code),
      };
    }

    const upsertResult = await upsertContentAnnotationBySession({
      session_id: parsed.data.sessionId,
      main_kw: summaryResult.fields.main_kw,
      kw: summaryResult.fields.kw,
      needs: summaryResult.fields.needs,
      persona: summaryResult.fields.persona,
      goal: summaryResult.fields.goal,
      prep: summaryResult.fields.prep,
      basic_structure: summaryResult.fields.basic_structure,
      opening_proposal: summaryResult.fields.opening_proposal,
      impressions: summaryResult.fields.impressions,
    });

    if (isEmailLinkConflictResult(upsertResult)) {
      return {
        success: false as const,
        error: upsertResult.error,
        emailLinkConflict: true as const,
      };
    }

    if (!upsertResult.success) {
      return {
        success: false as const,
        error: upsertResult.error ?? ERROR_MESSAGES.COMMON.SAVE_FAILED,
      };
    }

    const refreshed = await getContentAnnotationBySession(parsed.data.sessionId);
    if (isEmailLinkConflictResult(refreshed)) {
      return {
        success: false as const,
        error: refreshed.error,
        emailLinkConflict: true as const,
      };
    }

    if (!refreshed.success) {
      return {
        success: false as const,
        error: refreshed.error ?? ERROR_MESSAGES.COMMON.SERVER_ERROR,
      };
    }

    if (!refreshed.data) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.COMMON.SERVER_ERROR,
      };
    }

    return {
      success: true as const,
      data: refreshed.data,
    };
  });

  if (isWithAuthEmailLinkConflict(authResult)) {
    return {
      success: false,
      error: authResult.error,
      emailLinkConflict: true,
    };
  }

  return authResult;
}
