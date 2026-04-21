'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { SupabaseService } from '@/server/services/supabaseService';
import { googleAdsAiAnalysisService } from '@/server/services/googleAdsAiAnalysisService';
import { updateGoogleAdsEvaluationSettingsSchema } from '@/server/schemas/googleAdsEvaluation.schema';
import type {
  GoogleAdsAiAnalysisResult,
  GoogleAdsEvaluationSettings,
  UpdateGoogleAdsEvaluationSettingsInput,
} from '@/types/google-ads-evaluation';

const DEFAULT_SETTINGS: GoogleAdsEvaluationSettings = {
  dateRangeDays: 30,
  cronEnabled: false,
  lastEvaluatedOn: null,
};

async function getAuthenticatedUserId() {
  const authResult = await authMiddleware();
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) {
    return { success: false as const, error: linkConflict.error, emailLinkConflict: true as const };
  }
  if (authResult.error || !authResult.userId) {
    return { success: false as const, error: ERROR_MESSAGES.AUTH.UNAUTHENTICATED };
  }

  return { success: true as const, userId: authResult.userId, userDetails: authResult.userDetails };
}

export async function runGoogleAdsAiAnalysis(): Promise<GoogleAdsAiAnalysisResult> {
  try {
    const auth = await getAuthenticatedUserId();
    if (!auth.success) {
      return {
        success: false,
        error: auth.error,
      };
    }

    if (!auth.userDetails?.email) {
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_AI_EVALUATION,
      };
    }

    const result = await googleAdsAiAnalysisService.analyzeAndSend(auth.userId);
    if (result.success) {
      revalidatePath('/google-ads-dashboard');
    }
    return result;
  } catch (error) {
    console.error('[runGoogleAdsAiAnalysis] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED,
    };
  }
}

export async function getEvaluationSettings(): Promise<{
  success: boolean;
  data?: GoogleAdsEvaluationSettings;
  error?: string;
  emailLinkConflict?: true;
}> {
  try {
    const auth = await getAuthenticatedUserId();
    if (!auth.success) {
      return {
        success: false,
        error: auth.error,
        ...(auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }

    const supabaseService = new SupabaseService();
    const result = await supabaseService.getGoogleAdsEvaluationSettings(auth.userId);
    if (!result.success) {
      return {
        success: false,
        error: result.error.userMessage,
      };
    }

    if (!result.data) {
      return { success: true, data: DEFAULT_SETTINGS };
    }

    return {
      success: true,
      data: {
        dateRangeDays: result.data.dateRangeDays,
        cronEnabled: result.data.cronEnabled,
        lastEvaluatedOn: result.data.lastEvaluatedOn,
      },
    };
  } catch (error) {
    console.error('[getEvaluationSettings] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_FETCH_FAILED,
    };
  }
}

export async function updateEvaluationSettings(
  input: UpdateGoogleAdsEvaluationSettingsInput
): Promise<{
  success: boolean;
  error?: string;
  emailLinkConflict?: true;
}> {
  try {
    const auth = await getAuthenticatedUserId();
    if (!auth.success) {
      return {
        success: false,
        error: auth.error,
        ...(auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }

    const parseResult = updateGoogleAdsEvaluationSettingsSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues.map(issue => issue.message).join(', '),
      };
    }

    const supabaseService = new SupabaseService();
    const settingsResult = await supabaseService.getGoogleAdsEvaluationSettings(auth.userId);
    if (!settingsResult.success) {
      return {
        success: false,
        error: settingsResult.error.userMessage,
      };
    }

    const credential = await supabaseService.getGoogleAdsCredential(auth.userId);
    if (!credential?.customerId) {
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED,
      };
    }

    if (!settingsResult.data) {
      const upsertResult = await supabaseService.upsertGoogleAdsEvaluationSettings({
        userId: auth.userId,
        customerId: credential.customerId,
        customerName: null,
        dateRangeDays: parseResult.data.dateRangeDays ?? DEFAULT_SETTINGS.dateRangeDays,
        cronEnabled: parseResult.data.cronEnabled ?? DEFAULT_SETTINGS.cronEnabled,
      });
      if (!upsertResult.success) {
        return {
          success: false,
          error: upsertResult.error.userMessage,
        };
      }
    } else {
      const updateResult = await supabaseService.updateGoogleAdsEvaluationSettings(auth.userId, {
        ...(parseResult.data.dateRangeDays !== undefined && {
          date_range_days: parseResult.data.dateRangeDays,
        }),
        ...(parseResult.data.cronEnabled !== undefined && {
          cron_enabled: parseResult.data.cronEnabled,
        }),
      });
      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error.userMessage,
        };
      }
    }

    revalidatePath('/google-ads-dashboard');
    return { success: true };
  } catch (error) {
    console.error('[updateEvaluationSettings] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_UPDATE_FAILED,
    };
  }
}
