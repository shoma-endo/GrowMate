'use server';

import { revalidatePath } from 'next/cache';
import { getPromptTemplates, updatePromptTemplate } from '@/server/actions/prompt.actions';
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

export async function fetchPrompts() {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }

    const result = await getPromptTemplates();
    if (!result.success) {
      return {
        success: false,
        error: result.error || ERROR_MESSAGES.PROMPT.FETCH_FAILED,
        ...('emailLinkConflict' in result && result.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }
    return { success: true, data: result.data };
  } catch (error) {
    console.error('[admin/prompts] fetch failed', error);
    return { success: false, error: ERROR_MESSAGES.PROMPT.FETCH_FAILED };
  }
}

export async function savePrompt(params: {
  id: string;
  name: string;
  display_name: string;
  content: string;
  variables: unknown;
}) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }
    const variables =
      Array.isArray(params.variables) && params.variables.length > 0
        ? params.variables.filter(
            (v): v is { name: string; description: string } =>
              v != null &&
              typeof (v as { name?: unknown }).name === 'string' &&
              typeof (v as { description?: unknown }).description === 'string'
          )
        : [];

    const result = await updatePromptTemplate(params.id, {
      name: params.name,
      display_name: params.display_name,
      content: params.content,
      variables,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error || ERROR_MESSAGES.COMMON.SAVE_FAILED,
        ...('emailLinkConflict' in result && result.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    revalidatePath('/admin/prompts');
    return { success: true };
  } catch (error) {
    console.error('[admin/prompts] save failed', error);
    return { success: false, error: ERROR_MESSAGES.COMMON.SAVE_FAILED };
  }
}
