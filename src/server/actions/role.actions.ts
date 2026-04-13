'use server';

import { isUnavailable } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * ユーザーの権限を確認するサーバーアクション
 * Email セッション経由で解決する
 */
export const checkUserRole = async () => {
  try {
    const { resolveEmailUserWithReason } = await import('@/server/auth/resolveUser');
    const result = await resolveEmailUserWithReason();
    if (!result.ok) {
      if (result.reason === 'transient') {
        return {
          success: false,
          error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
          role: 'trial' as const,
        };
      }
      if (result.reason === 'email_link_conflict') {
        return {
          success: false,
          error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT,
          role: 'trial' as const,
        };
      }
      return {
        success: false,
        error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND,
        role: 'trial' as const,
      };
    }
    if (isUnavailable(result.user.role)) {
      return {
        success: false,
        error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
        role: result.user.role ?? ('trial' as const),
      };
    }
    return {
      success: true,
      role: result.user.role ?? ('trial' as const),
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
