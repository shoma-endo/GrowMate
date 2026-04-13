import { cookies as nextCookies } from 'next/headers';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { User } from '@/types/user';

export interface AuthenticatedUser {
  /** @deprecated 常に空文字。LINE認証廃止につき未使用 */
  lineUserId: string;
  userId: string;
  user?: { id: string };
  userDetails?: User | null;
  error?: string;
  /** 一時障害時は true。呼び出し元で 503 を返すために使う */
  transient?: boolean;
  /** メールと public.users の紐付け競合（再ログインでは解消しない）。409 用 */
  emailLinkConflict?: boolean;
}

export type AuthMiddlewareResult = AuthenticatedUser;

/**
 * Email セッションを解決し、成功時は AuthenticatedUser、transient 障害時はエラー結果、
 * unauthenticated 時は null を返す。
 */
async function tryEmailFallback(): Promise<AuthenticatedUser | null> {
  const { resolveEmailUserWithReason } = await import('@/server/auth/resolveUser');
  const result = await resolveEmailUserWithReason();
  if (result.ok) {
    const emailUser = result.user;
    return {
      lineUserId: '',
      userId: emailUser.id,
      user: { id: emailUser.id },
      userDetails: emailUser,
    };
  }
  if (result.reason === 'transient') {
    return {
      error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
      transient: true,
      lineUserId: '',
      userId: '',
      userDetails: null,
    };
  }
  if (result.reason === 'email_link_conflict') {
    return {
      error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT,
      lineUserId: '',
      userId: '',
      userDetails: null,
      emailLinkConflict: true,
    };
  }
  return null;
}

export async function ensureAuthenticated(): Promise<AuthenticatedUser> {
  const emailResult = await tryEmailFallback();
  if (emailResult) return emailResult;
  return {
    error: ERROR_MESSAGES.AUTH.UNAUTHENTICATED,
    lineUserId: '',
    userId: '',
    userDetails: null,
  };
}

export async function authMiddleware(
  _liffAccessToken?: string,
  _refreshTokenValue?: string,
  _options?: Record<string, unknown>
): Promise<AuthMiddlewareResult> {
  return ensureAuthenticated();
}

export async function clearAuthCookies(): Promise<void> {
  const cookies = await nextCookies();
  cookies.delete('line_access_token');
  cookies.delete('line_refresh_token');
}
