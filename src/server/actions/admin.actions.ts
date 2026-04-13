'use server';

import { userService } from '@/server/services/userService';
import { isAdmin, isUnavailable } from '@/authUtils';
import type { User, UserRole } from '@/types/user';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';

/** Email セッションで管理者権限を解決する */
async function resolveAdminUser(): Promise<
  | { success: true; role: UserRole }
  | { success: false; error: string }
> {
  const result = await resolveEmailUserWithReason();
  if (!result.ok) {
    if (result.reason === 'transient') {
      return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
    }
    if (result.reason === 'email_link_conflict') {
      return { success: false, error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT };
    }
    return { success: false, error: ERROR_MESSAGES.AUTH.NOT_LOGGED_IN };
  }
  const emailUser = result.user;
  if (isUnavailable(emailUser.role)) {
    return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
  }
  if (!isAdmin(emailUser.role)) {
    return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
  }
  return { success: true, role: emailUser.role };
}

export const getAllUsers = async (): Promise<{
  success: boolean;
  users?: User[];
  error?: string;
}> => {
  try {
    const authResult = await resolveAdminUser();
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }

    const users = await userService.getAllUsers();
    return { success: true, users };
  } catch (error) {
    console.error('ユーザー一覧取得エラー:', error);
    return { success: false, error: ERROR_MESSAGES.USER.USER_LIST_FETCH_ERROR };
  }
};

/**
 * ユーザーの権限を更新するサーバーアクション
 */
export const updateUserRole = async (
  userId: string,
  newRole: UserRole
): Promise<{ success: boolean; error?: string }> => {
  try {
    const authResult = await resolveAdminUser();
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }

    // バリデーション: 有効なロールかチェック
    const validRoles: UserRole[] = ['trial', 'paid', 'admin', 'unavailable'];
    if (!validRoles.includes(newRole)) {
      return { success: false, error: ERROR_MESSAGES.USER.INVALID_ROLE };
    }

    // ユーザーの存在確認
    const targetUser = await userService.getUserById(userId);
    if (!targetUser) {
      return { success: false, error: ERROR_MESSAGES.USER.USER_NOT_FOUND };
    }

    // 権限更新の実行
    await userService.updateUserRole(userId, newRole);

    return { success: true };
  } catch (error) {
    console.error('ユーザー権限更新エラー:', error);
    return { success: false, error: ERROR_MESSAGES.USER.ROLE_UPDATE_ERROR };
  }
};
