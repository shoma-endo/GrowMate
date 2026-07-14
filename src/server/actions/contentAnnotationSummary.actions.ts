'use server';

import { withAuth, isWithAuthEmailLinkConflict } from '@/server/middleware/withAuth.middleware';
import {
  getContentAnnotationSummaryErrorMessage,
  contentAnnotationSummaryService,
} from '@/server/services/contentAnnotationSummaryService';
import {
  summarizeContentAnnotationSchema,
  type SummarizeContentAnnotationTarget,
} from '@/server/schemas/contentAnnotationSummary.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { AnnotationRecord } from '@/types/annotation';

type SummarizeContentAnnotationResult =
  | { success: true; data: AnnotationRecord }
  | { success: false; error: string; emailLinkConflict?: true };

export async function summarizeContentAnnotation(
  target: SummarizeContentAnnotationTarget
): Promise<SummarizeContentAnnotationResult> {
  const parsed = summarizeContentAnnotationSchema.safeParse(target);
  if (!parsed.success) {
    return {
      success: false,
      error: '入力データが不正です。ページを更新してから再度お試しください。',
    };
  }

  const authResult = await withAuth(async ({ userId, cookieStore }) => {
    const summaryResult = await contentAnnotationSummaryService.generateSummary({
      target: parsed.data,
      executorUserId: userId,
      cookieStore,
    });

    if (!summaryResult.success) {
      return {
        success: false as const,
        error: getContentAnnotationSummaryErrorMessage(summaryResult.code),
      };
    }

    const saveResult = await contentAnnotationSummaryService.saveSummary({
      annotationId: summaryResult.annotationId,
      userId: summaryResult.userId,
      fields: summaryResult.fields,
    });

    if (!saveResult.success) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.COMMON.SAVE_FAILED,
      };
    }

    return {
      success: true as const,
      data: saveResult.data,
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
