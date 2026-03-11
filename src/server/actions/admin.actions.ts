'use server';

import { userService } from '@/server/services/userService';
import { checkUserRole } from './role.actions';
import { isAdmin, isUnavailable } from '@/authUtils';
import type { User, UserRole } from '@/types/user';
import { isViewModeEnabled, VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';

export const getAllUsers = async (): Promise<{
  success: boolean;
  users?: User[];
  error?: string;
}> => {
  try {
    const { accessToken: lineAccessToken } = await getLiffTokensFromCookies();

    if (!lineAccessToken) {
      return { success: false, error: ERROR_MESSAGES.AUTH.NOT_LOGGED_IN };
    }

    // 管理者権限チェック
    const roleResult = await checkUserRole(lineAccessToken);
    if (!roleResult.success) {
      return { success: false, error: roleResult.error || ERROR_MESSAGES.USER.PERMISSION_ACQUISITION_FAILED };
    }

    // unavailableユーザーのサービス利用制限チェック
    if (isUnavailable(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
    }

    if (!isAdmin(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
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
    const { accessToken: lineAccessToken } = await getLiffTokensFromCookies();

    if (!lineAccessToken) {
      return { success: false, error: ERROR_MESSAGES.AUTH.NOT_LOGGED_IN };
    }

    // 管理者権限チェック
    const roleResult = await checkUserRole(lineAccessToken);
    if (!roleResult.success) {
      return { success: false, error: roleResult.error || ERROR_MESSAGES.USER.PERMISSION_ACQUISITION_FAILED };
    }
    if (await isViewModeEnabled(roleResult.role)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    // unavailableユーザーのサービス利用制限チェック
    if (isUnavailable(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
    }

    if (!isAdmin(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
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
