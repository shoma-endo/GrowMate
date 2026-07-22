'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { userService } from '@/server/services/userService';
import { isAdmin } from '@/authUtils';
import type { AdminUserListItem, UserRole } from '@/types/user';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';
import { deleteUserSchema, type DeleteUserInput } from '@/server/schemas/admin.schema';

/** Email セッションで管理者権限を解決する */
async function resolveAdminUser(): Promise<
  | { success: true; role: UserRole; userId: string }
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
    if (result.reason === 'pending_auth_deletion') {
      return { success: false, error: ERROR_MESSAGES.AUTH.PENDING_AUTH_DELETION };
    }
    if (result.reason === 'unavailable') {
      return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
    }
    return { success: false, error: ERROR_MESSAGES.AUTH.NOT_LOGGED_IN };
  }
  const emailUser = result.user;
  if (!isAdmin(emailUser.role)) {
    return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
  }
  return { success: true, role: emailUser.role, userId: emailUser.id };
}

export const getAllUsers = async (): Promise<{
  success: boolean;
  users?: AdminUserListItem[];
  error?: string;
}> => {
  try {
    const authResult = await resolveAdminUser();
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }

    const users = await userService.getAllUsersForAdmin();
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

/**
 * 管理者によるユーザー完全削除サーバーアクション
 */
export const deleteUser = async (
  input: DeleteUserInput
): Promise<{ success: boolean; error?: string }> => {
  try {
    const authResult = await resolveAdminUser();
    if (!authResult.success) {
      return { success: false, error: authResult.error };
    }

    const parsed = deleteUserSchema.safeParse(input);
    if (!parsed.success) {
      console.error('ユーザー削除の入力検証エラー:', z.prettifyError(parsed.error));
      return { success: false, error: ERROR_MESSAGES.USER.DELETE_TARGET_INVALID };
    }

    const result = await userService.deleteUserFully(parsed.data.userId, authResult.userId);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    console.error('ユーザー削除エラー:', error);
    return { success: false, error: ERROR_MESSAGES.USER.DELETE_DB_FAILED };
  }
};
