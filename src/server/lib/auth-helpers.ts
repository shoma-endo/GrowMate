import { NextResponse, type NextRequest } from 'next/server';
import type { User, UserRole } from '@/types/user';
import { userService } from '@/server/services/userService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

type AuthHeaderSuccess = {
  ok: true;
  user: User;
  role: UserRole | null;
  token: string;
};

type AuthHeaderFailure = {
  ok: false;
  response: NextResponse;
};

export type AuthHeaderResult = AuthHeaderSuccess | AuthHeaderFailure;

/**
 * Email セッションからユーザー情報を取得する。
 * @param _req 未使用。後方互換のためオプショナルで残している
 */
export async function getUserFromAuthHeader(_req?: NextRequest): Promise<AuthHeaderResult> {
  const authResult = await authMiddleware();
  const conflict409 = nextJson409IfEmailLinkConflict(authResult, msg => ({ error: msg }));
  if (conflict409) {
    return { ok: false, response: conflict409 };
  }
  if (authResult.error || !authResult.userId) {
    return { ok: false, response: NextResponse.json({ error: ERROR_MESSAGES.AUTH.UNAUTHENTICATED }, { status: 401 }) };
  }
  const user = await userService.getUserById(authResult.userId);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: ERROR_MESSAGES.USER.USER_NOT_FOUND }, { status: 401 }) };
  }
  return {
    ok: true,
    user,
    role: authResult.userDetails?.role ?? user.role ?? null,
    token: '',
  };
}


