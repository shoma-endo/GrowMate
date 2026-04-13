import { cookies } from 'next/headers';
import { authMiddleware } from './auth.middleware';
import { getEmailLinkConflictMessage } from '@/server/middleware/authMiddlewareGuards';
import type { User } from '@/types/user';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

/**
 * 認証コンテキスト
 */
export interface AuthContext {
  userId: string;
  cookieStore: ReadonlyRequestCookies;
  userDetails?: User | null;
}

/**
 * withAuth がメール紐付け競合のとき返す構造化失敗（Server Action の { success: false, error } と整合）
 */
export type WithAuthEmailLinkConflict = {
  success: false;
  error: string;
  emailLinkConflict: true;
};

export function isWithAuthEmailLinkConflict(
  value: unknown
): value is WithAuthEmailLinkConflict {
  return (
    typeof value === 'object' &&
    value !== null &&
    'emailLinkConflict' in value &&
    (value as WithAuthEmailLinkConflict).emailLinkConflict === true
  );
}

/**
 * Server Actions / Route Handlers 用の認証ラッパー。
 * Email セッションで認証を解決する。
 */
export async function withAuth<T>(
  handler: (context: AuthContext) => Promise<T>
): Promise<T | WithAuthEmailLinkConflict> {
  const cookieStore = await cookies();

  const authResult = await authMiddleware();

  const conflictMessage = getEmailLinkConflictMessage(authResult);
  if (conflictMessage !== undefined) {
    return {
      success: false,
      error: conflictMessage,
      emailLinkConflict: true,
    };
  }

  if (authResult.error || !authResult.userId) {
    throw new Error(authResult.error ?? '認証に失敗しました');
  }

  return handler({
    userId: authResult.userId,
    cookieStore,
    userDetails: authResult.userDetails ?? null,
  });
}
