"use server"

import { userService } from '@/server/services/userService';
import {
  isViewModeEnabled,
  resolveViewModeRole,
  VIEW_MODE_ERROR_MESSAGE,
} from '@/server/lib/view-mode';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';

export const updateUserFullName = async (fullName: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const { accessToken: lineAccessToken, refreshToken } = await getLiffTokensFromCookies();

    if (!lineAccessToken) {
      return { success: false, error: ERROR_MESSAGES.AUTH.NOT_LOGGED_IN };
    }

    const authResult = await authMiddleware(lineAccessToken, refreshToken);
    if (authResult.error) {
      return { success: false, error: authResult.error };
    }

    if (await isViewModeEnabled(resolveViewModeRole(authResult))) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    if (!authResult.userId) {
      return { success: false, error: ERROR_MESSAGES.USER.USER_NOT_FOUND };
    }

    const success = await userService.updateFullName(authResult.userId, fullName);
    if (!success) {
      return { success: false, error: ERROR_MESSAGES.USER.FULL_NAME_UPDATE_FAILED };
    }

    return { success: true };
  } catch (error) {
    console.error('フルネーム更新エラー:', error);
    return { success: false, error: ERROR_MESSAGES.USER.FULL_NAME_UPDATE_ERROR };
  }
};
