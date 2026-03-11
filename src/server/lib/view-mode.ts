import { cookies } from 'next/headers';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import type { UserRole } from '@/types/user';

export const VIEW_MODE_ERROR_MESSAGE = '閲覧モードでは操作できません';

/**
 * 閲覧モード判定の内部共通ロジック
 * 注意: 'owner'ロールはスタッフ（閲覧権限）を指す。オーナー本人はadmin/paidロール
 */
export const isViewModeEnabledByRole = (role: UserRole | null): boolean => {
  // 'owner'ロール（スタッフ・閲覧権限）は常に閲覧モードとして扱う
  if (role === 'owner') return true;
  return false;
};

export const resolveViewModeRole = (authResult: {
  viewMode?: boolean;
  actorRole?: UserRole | null;
  userDetails?: { role?: UserRole | null } | null;
}): UserRole | null => {
  if (authResult.viewMode) {
    return authResult.actorRole ?? authResult.userDetails?.role ?? null;
  }
  return authResult.userDetails?.role ?? null;
};

const resolveRoleFromCookies = async (): Promise<UserRole | null> => {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  if (!accessToken && !refreshToken) {
    return null;
  }

  const authResult = await authMiddleware(accessToken, refreshToken);

  if (authResult.error) {
    return null;
  }

  return resolveViewModeRole(authResult);
};

export const isViewModeEnabled = async (role?: UserRole | null): Promise<boolean> => {
  if (role !== undefined) {
    return isViewModeEnabledByRole(role ?? null);
  }

  const resolvedRole = await resolveRoleFromCookies();
  return isViewModeEnabledByRole(resolvedRole);
};
