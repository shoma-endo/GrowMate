import type { NextResponse } from 'next/server';
import { verifyOAuthState } from '@/server/lib/oauth-state';

const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 15,
  sameSite: 'lax' as const,
};

export function setOAuthStateCookie(
  response: NextResponse,
  cookieName: string,
  state: string
): void {
  response.cookies.set(cookieName, state, OAUTH_STATE_COOKIE_OPTIONS);
}

export function verifyOAuthStateCookie(params: {
  storedState: string | undefined;
  receivedState: string;
}): 'ok' | 'state_cookie_mismatch' {
  if (!params.storedState || params.storedState !== params.receivedState) {
    return 'state_cookie_mismatch';
  }
  return 'ok';
}

export type OAuthStateVerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

export function verifySignedOAuthState(params: {
  state: string;
  cookieSecret: string;
}): OAuthStateVerificationResult {
  const verification = verifyOAuthState(params.state, params.cookieSecret);
  if (!verification.valid) {
    return { ok: false, reason: verification.reason };
  }
  return { ok: true, userId: verification.payload.userId };
}

export function resolveOAuthTargetUserId(params: {
  stateUserId: string;
  sessionUserId: string | null;
}): { ok: true; userId: string } | { ok: false; reason: 'state_user_mismatch' | 'auth_required' } {
  if (params.sessionUserId) {
    if (params.stateUserId !== params.sessionUserId) {
      return { ok: false, reason: 'state_user_mismatch' };
    }
    return { ok: true, userId: params.sessionUserId };
  }

  if (!params.stateUserId) {
    return { ok: false, reason: 'auth_required' };
  }

  return { ok: true, userId: params.stateUserId };
}
