'use server';

import { userService } from '@/server/services/userService';
import { checkUserRole } from './role.actions';
import { isAdmin, isUnavailable } from '@/authUtils';
import type { User, UserRole } from '@/types/user';
import { isViewModeEnabled, VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';

/** LINE / Email いずれかのセッションで管理者権限を解決する
 *
 * middleware と同じ優先順位: LINE Cookie がある場合は LINE パス、なければ Email パス。
 * 両セッションが共存する場合も middleware と一致した判定になるようにする。
 */
async function resolveAdminUser(): Promise<
  | { success: true; role: UserRole; lineAccessToken: string | undefined }
  | { success: false; error: string }
> {
  // middleware と同じ優先順位: LINE Cookie がある場合は LINE を優先
  const { accessToken: lineAccessToken } = await getLiffTokensFromCookies();

  if (lineAccessToken) {
    const roleResult = await checkUserRole(lineAccessToken);
    if (!roleResult.success) {
      return { success: false, error: roleResult.error || ERROR_MESSAGES.USER.PERMISSION_ACQUISITION_FAILED };
    }
    if (isUnavailable(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
    }
    if (!isAdmin(roleResult.role)) {
      return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
    }
    return { success: true, role: roleResult.role, lineAccessToken };
  }

  // LINE Cookie なし: 共通の Email 解決（一時障害は SERVICE_UNAVAILABLE で返す）
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
  return { success: true, role: emailUser.role, lineAccessToken: undefined };
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

    // 閲覧モードチェック（LINE ユーザーのみ。Email ユーザーはビューモード不使用）
    if (authResult.lineAccessToken && await isViewModeEnabled(authResult.role)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
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
