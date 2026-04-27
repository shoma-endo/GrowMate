import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { AuthEmailLinkConflictError } from '@/domain/errors/AuthEmailLinkConflictError';
import type { AuthMiddlewareResult } from '@/server/middleware/auth.middleware';

/**
 * authMiddleware / ensureAuthenticated 結果から、競合時の表示用メッセージを返す。
 * 競合でなければ undefined。
 */
export function getEmailLinkConflictMessage(authResult: AuthMiddlewareResult): string | undefined {
  if (!authResult.emailLinkConflict) return undefined;
  return authResult.error ?? ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT;
}

/**
 * authMiddleware 結果が「利用可能なログインユーザー」でなければ例外で打ち切る。
 * メール紐付け競合は {@link AuthEmailLinkConflictError}（再ログインでは解消しない）。
 */
function throwIfAuthMiddlewareRejectsAuth(
  authResult: AuthMiddlewareResult,
  fallbackMessage = '認証に失敗しました'
): asserts authResult is AuthMiddlewareResult & { userId: string } {
  const conflictMessage = getEmailLinkConflictMessage(authResult);
  if (conflictMessage !== undefined) {
    throw new AuthEmailLinkConflictError(conflictMessage);
  }
  if (authResult.error || !authResult.userId) {
    throw new Error(authResult.error ?? fallbackMessage);
  }
}

/**
 * Server Action 等で `return { error: ... }` する前に呼ぶ。
 * 競合時のみ `{ success: false; error; emailLinkConflict: true }` を返し、それ以外は null。
 * isEmailLinkConflictResult() で検出可能な完全な型を返す。
 */
export function emailLinkConflictErrorPayload(
  authResult: AuthMiddlewareResult
): { success: false; error: string; emailLinkConflict: true } | null {
  const message = getEmailLinkConflictMessage(authResult);
  return message === undefined ? null : { success: false, error: message, emailLinkConflict: true };
}

/**
 * メッセージが静的な 409（`resolveEmailUserWithReason` の `email_link_conflict` 等）。
 * `overrides` で `userId` / `user` など追加フィールドをマージする。
 */
export function nextJson409EmailLinkConflict(overrides: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json(
    { error: ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT, ...overrides },
    { status: 409 }
  );
}

/**
 * Route Handler 用: `authResult` がメール紐付け競合のときだけ `NextResponse.json(409)` を返す。
 * デフォルト body は `{ success: false, error: message }`。OAuth 等は第2引数で `{ error }` のみに差し替え。
 */
export function nextJson409IfEmailLinkConflict(
  authResult: AuthMiddlewareResult,
  body: (message: string) => Record<string, unknown> = (msg) => ({ success: false, error: msg })
): NextResponse | null {
  const message = getEmailLinkConflictMessage(authResult);
  if (message === undefined) return null;
  return NextResponse.json(body(message), { status: 409 });
}

const LOGIN_EMAIL_LINK_CONFLICT_RELATIVE = '/login?reason=email_link_conflict';

/**
 * ブラウザのフルページ遷移で開く OAuth 開始 Route 用。
 * JSON 409 だと生レスポンスになるため、ログインへリダイレクトする。
 * `request` がないハンドラでは `NEXT_PUBLIC_SITE_URL` / `VERCEL_URL` / localhost をフォールバックする。
 */
function nextResponseRedirectLoginEmailLinkConflict(request?: NextRequest): NextResponse {
  if (request) {
    return NextResponse.redirect(new URL(LOGIN_EMAIL_LINK_CONFLICT_RELATIVE, request.url));
  }
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'http://localhost:3000';
  return NextResponse.redirect(`${base}${LOGIN_EMAIL_LINK_CONFLICT_RELATIVE}`);
}

/** OAuth 開始など「ブラウザ遷移」専用: 競合時のみリダイレクト Response、それ以外は null */
export function nextResponseRedirectLoginIfEmailLinkConflict(
  authResult: AuthMiddlewareResult,
  request?: NextRequest
): NextResponse | null {
  if (getEmailLinkConflictMessage(authResult) === undefined) return null;
  return nextResponseRedirectLoginEmailLinkConflict(request);
}

const EMAIL_LINK_CONFLICT_SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
};

/**
 * SSE Route 用: 競合時のみ 409 + `email_link_conflict` イベントの Response を返す。
 */
export function sse409IfEmailLinkConflict(
  authResult: AuthMiddlewareResult,
  sendSSE: (event: string, data: unknown) => Uint8Array
): Response | null {
  const message = getEmailLinkConflictMessage(authResult);
  if (message === undefined) return null;
  const body = sendSSE('error', { type: 'email_link_conflict', message }) as BodyInit;
  return new Response(body, {
    status: 409,
    headers: EMAIL_LINK_CONFLICT_SSE_HEADERS,
  });
}

/**
 * Server Component（setup ページ等）: 競合時は `/login?reason=email_link_conflict` へ `redirect`。
 */
export function redirectIfEmailLinkConflict(authResult: AuthMiddlewareResult): void {
  if (authResult.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }
}
