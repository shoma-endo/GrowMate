import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { UserRole } from '@/types/user';

// =========================
// クライアント安全なヘルパー
// =========================
export function isAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}

export function isUnavailable(role: UserRole | null): boolean {
  return role === 'unavailable';
}

/**
 * role が 'owner' かどうかを判定
 * 注意: 'owner' は閲覧専用権限のユーザーを指す
 * スタッフユーザーは role='paid' + ownerUserId が設定されている
 */
export function hasOwnerRole(role: UserRole | null): boolean {
  return role === 'owner';
}

/**
 * 閲覧専用オーナー(role='owner')でかつ他のオーナーに紐付いていないユーザーかを判定
 * - 閲覧専用オーナー: role='owner' かつ ownerUserId=null
 * - スタッフユーザー: role='paid' かつ ownerUserId が設定されている
 * 注意: この関数は閲覧専用オーナーの判定であり、スタッフ判定には使用できない
 */
export function isActualOwner(
  role: UserRole | null,
  ownerUserId: string | null | undefined
): boolean {
  return role === 'owner' && !ownerUserId;
}

/**
 * 一括インポート（WordPress / GSC）の操作別認可
 * - role が null / unavailable は不可
 * - スタッフ（ownerUserIdあり）は不可
 * - role='owner' は可（能力定義上の許可）
 * - それ以外は閲覧モード中のみ不可
 */
export function canRunBulkImport(params: {
  role: UserRole | null;
  ownerUserId: string | null | undefined;
  isOwnerViewMode: boolean;
}): boolean {
  const { role, ownerUserId, isOwnerViewMode } = params;
  if (!role || role === 'unavailable') return false;
  if (isActualOwner(role, ownerUserId)) return true;
  if (ownerUserId) return false;
  return !isOwnerViewMode;
}

export function getRoleDisplayName(role: UserRole | null): string {
  switch (role) {
    case 'admin':
      return '管理者';
    case 'trial':
      return 'お試しユーザー';
    case 'paid':
      return '有料契約ユーザー';
    case 'owner':
      return '閲覧権限';
    case 'unavailable':
      return 'サービス利用停止';
    default:
      return '不明';
  }
}

// =========================
// サーバー専用API（動的import + クライアントガード）
// =========================
export async function getUserRole(accessToken: string): Promise<UserRole | null> {
  if (typeof window !== 'undefined') {
    throw new Error('getUserRole can only be called on the server');
  }
  const { userService } = await import('@/server/services/userService');
  try {
    const user = await userService.getUserFromLiffToken(accessToken);
    if (!user) {
      return null;
    }
    return user.role || 'trial';
  } catch (error) {
    console.error('[Auth Utils] Failed to get user role:', {
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}

export async function getUserRoleWithRefresh(
  accessToken: string,
  refreshToken?: string
): Promise<{
  role: UserRole | null;
  newAccessToken?: string;
  newRefreshToken?: string;
  expiresIn?: number;
  needsReauth?: boolean;
}> {
  if (typeof window !== 'undefined') {
    throw new Error('getUserRoleWithRefresh can only be called on the server');
  }
  const { userService } = await import('@/server/services/userService');
  try {
    const result = await userService.getUserFromLiffTokenWithRefresh(accessToken, refreshToken);
    if (result.needsReauth) {
      return { role: null, needsReauth: true };
    }
    if (!result.user) {
      return { role: null };
    }
    const role = result.user.role || 'trial';
    const returnValue: {
      role: UserRole;
      newAccessToken?: string;
      newRefreshToken?: string;
      expiresIn?: number;
      needsReauth?: boolean;
    } = { role };
    if (result.newAccessToken) returnValue.newAccessToken = result.newAccessToken;
    if (result.newRefreshToken) returnValue.newRefreshToken = result.newRefreshToken;
    if (result.expiresIn !== undefined) returnValue.expiresIn = result.expiresIn;
    return returnValue;
  } catch (error) {
    console.error('[Auth Utils] Failed to get user role with refresh:', {
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      timestamp: new Date().toISOString(),
    });
    return { role: null };
  }
}
