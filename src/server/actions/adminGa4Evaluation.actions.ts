'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

const validateAdminAccessOrError = async () => {
  const authResult = await authMiddleware();
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return linkConflict;
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  if (authResult.userDetails?.role !== 'admin') {
    return { error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS };
  }
  return { authResult };
};

const setEnabledSchema = z.object({ enabled: z.boolean() });

export async function fetchGa4EvaluationSettings() {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const settings = await ga4ContentEvaluationService.getEvaluationSettings();
    return {
      success: true as const,
      data: { enabled: settings.enabled, updatedAt: settings.updatedAt },
    };
  } catch (error) {
    console.error('[admin/ga4-evaluation] settings fetch failed', error);
    return {
      success: false as const,
      error: ERROR_MESSAGES.GA4.EVALUATION_SETTINGS_FETCH_FAILED,
    };
  }
}

export async function setGa4EvaluationEnabled(input: { enabled: boolean }) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const parsed = setEnabledSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false as const, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
    }

    await ga4ContentEvaluationService.setEvaluationEnabled(
      parsed.data.enabled,
      auth.authResult.userId
    );

    revalidatePath('/admin/ga4-evaluation');
    revalidatePath('/analytics');
    return { success: true as const, data: { enabled: parsed.data.enabled } };
  } catch (error) {
    console.error('[admin/ga4-evaluation] settings save failed', error);
    return {
      success: false as const,
      error: ERROR_MESSAGES.GA4.EVALUATION_SETTINGS_SAVE_FAILED,
    };
  }
}
