"use server"

import { userService } from '@/server/services/userService';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';

export const updateUserFullName = async (fullName: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) return linkConflict;
    if (authResult.error) {
      return { success: false, error: authResult.error };
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
