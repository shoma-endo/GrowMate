'use server';

import { userService } from '@/server/services/userService';
import { isUnavailable } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * ユーザーの権限を確認するサーバーアクション
 */
export const checkUserRole = async (liffAccessToken: string) => {
  try {
    const user = await userService.getUserFromLiffToken(liffAccessToken);

    if (!user) {
      return {
        success: false,
        error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND,
        role: 'trial' as const,
      };
    }

    // unavailableユーザーの場合は利用停止メッセージを返す
    if (isUnavailable(user.role)) {
      return {
        success: false,
        error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
        role: user.role || ('trial' as const),
      };
    }

    return {
      success: true,
      role: user.role || ('trial' as const),
    };
  } catch (error) {
    console.error(
      '権限チェックエラー:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return {
      success: false,
      error: ERROR_MESSAGES.USER.PERMISSION_ACQUISITION_FAILED,
      role: 'trial' as const,
    };
  }
};
