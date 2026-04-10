'use server';

import { revalidatePath } from 'next/cache';
import { getPromptTemplates, updatePromptTemplate } from '@/server/actions/prompt.actions';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

const getAccessTokenOrError = async () => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();
  const authResult = await authMiddleware(accessToken, refreshToken);
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return linkConflict;
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  if (authResult.userDetails?.role !== 'admin') {
    return { error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS };
  }
  return { accessToken: accessToken ?? '', authResult };
};

export async function fetchPrompts() {
  try {
    const auth = await getAccessTokenOrError();
    if ('error' in auth) {
      return { success: false, error: auth.error };
    }

    const result = await getPromptTemplates(auth.accessToken);
    if (!result.success) {
      return { success: false, error: result.error || ERROR_MESSAGES.PROMPT.FETCH_FAILED };
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
    const auth = await getAccessTokenOrError();
    if ('error' in auth) {
      return { success: false, error: auth.error };
    }
    if (await isViewModeEnabled(resolveViewModeRole(auth.authResult))) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
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

    const result = await updatePromptTemplate(auth.accessToken, params.id, {
      name: params.name,
      display_name: params.display_name,
      content: params.content,
      variables,
    });

    if (!result.success) {
      return { success: false, error: result.error || ERROR_MESSAGES.COMMON.SAVE_FAILED };
    }

    revalidatePath('/admin/prompts');
    return { success: true };
  } catch (error) {
    console.error('[admin/prompts] save failed', error);
    return { success: false, error: ERROR_MESSAGES.COMMON.SAVE_FAILED };
  }
}
