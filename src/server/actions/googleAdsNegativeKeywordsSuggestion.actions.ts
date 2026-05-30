'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { SupabaseService } from '@/server/services/supabaseService';
import { googleAdsNegativeKeywordsSuggestionService } from '@/server/services/googleAdsNegativeKeywordsSuggestionService';
import {
  updateNegativeKeywordsSuggestionSettingsSchema,
  type UpdateNegativeKeywordsSuggestionSettingsInput,
} from '@/server/schemas/googleAdsNegativeKeywordsSuggestion.schema';
import type {
  GoogleAdsNegativeKeywordsSuggestionResult,
  GoogleAdsNegativeKeywordsSuggestionSettings,
} from '@/types/google-ads-negative-keywords-suggestion';

const DEFAULT_SETTINGS: GoogleAdsNegativeKeywordsSuggestionSettings = {
  enabled: false,
  sendHourJst: 7,
  lastSentOn: null,
  lastSendError: null,
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

export async function getNegativeKeywordsSuggestionSettings(): Promise<{
  success: boolean;
  data?: GoogleAdsNegativeKeywordsSuggestionSettings;
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
    const result = await supabaseService.getGoogleAdsNegativeKeywordsSettings(auth.userId);
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
        enabled: result.data.enabled,
        sendHourJst: result.data.sendHourJst,
        lastSentOn: result.data.lastSentOn,
        lastSendError: result.data.lastSendError,
      },
    };
  } catch (error) {
    console.error('[getNegativeKeywordsSuggestionSettings] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_FETCH_FAILED,
    };
  }
}

export async function updateNegativeKeywordsSuggestionSettings(
  input: UpdateNegativeKeywordsSuggestionSettingsInput
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

    const parseResult = updateNegativeKeywordsSuggestionSettingsSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.issues.map(issue => issue.message).join(', '),
      };
    }

    const supabaseService = new SupabaseService();
    const credential = await supabaseService.getGoogleAdsCredential(auth.userId);
    if (!credential) {
      return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.NOT_CONNECTED };
    }
    if (!credential.customerId) {
      return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED };
    }

    const existing = await supabaseService.getGoogleAdsNegativeKeywordsSettings(auth.userId);
    if (!existing.success) {
      return { success: false, error: existing.error.userMessage };
    }

    if (!existing.data) {
      const upsertResult = await supabaseService.upsertGoogleAdsNegativeKeywordsSettings({
        userId: auth.userId,
        enabled: parseResult.data.enabled ?? DEFAULT_SETTINGS.enabled,
        sendHourJst: parseResult.data.sendHourJst ?? DEFAULT_SETTINGS.sendHourJst,
      });
      if (!upsertResult.success) {
        return { success: false, error: upsertResult.error.userMessage };
      }
    } else {
      const updateResult = await supabaseService.updateGoogleAdsNegativeKeywordsSettings(
        auth.userId,
        {
          ...(parseResult.data.enabled !== undefined && { enabled: parseResult.data.enabled }),
          ...(parseResult.data.sendHourJst !== undefined && {
            send_hour_jst: parseResult.data.sendHourJst,
          }),
        }
      );
      if (!updateResult.success) {
        return { success: false, error: updateResult.error.userMessage };
      }
    }

    revalidatePath('/google-ads-dashboard');
    return { success: true };
  } catch (error) {
    console.error('[updateNegativeKeywordsSuggestionSettings] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
    };
  }
}

export async function runNegativeKeywordsSuggestionNow(): Promise<GoogleAdsNegativeKeywordsSuggestionResult> {
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
        error: ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_NEGATIVE_KEYWORDS_SUGGESTION,
      };
    }

    const result =
      await googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(
        auth.userId,
        { force: true }
      );
    if (result.success) {
      revalidatePath('/google-ads-dashboard');
    }
    return result;
  } catch (error) {
    console.error('[runNegativeKeywordsSuggestionNow] Unexpected error:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED,
    };
  }
}
