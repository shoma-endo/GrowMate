import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {},
}));

vi.mock('@/server/services/gscService', () => ({
  GscService: class {},
  formatGscPropertyDisplayName: vi.fn(),
}));

import { generateOAuthState } from '@/server/lib/oauth-state';
import { GET as gscCallback } from '../../../../app/api/gsc/oauth/callback/route';
import { GET as wordpressCallback } from '../../../../app/api/wordpress/oauth/callback/route';

const COOKIE_SECRET = 'cookie-secret-for-test-cookie-secret';
const ATTACKER_USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

function callbackRequest(path: string, state: string, cookie?: string) {
  const request = new NextRequest(`http://localhost${path}?code=auth-code&state=${encodeURIComponent(state)}`);
  if (cookie) request.cookies.set(cookie.split('=')[0]!, cookie.slice(cookie.indexOf('=') + 1));
  return request;
}

const CALLBACKS = [
  ['GSC', '/api/gsc/oauth/callback', gscCallback, 'gsc_oauth_state'],
  ['WordPress', '/api/wordpress/oauth/callback', wordpressCallback, 'wpcom_oauth_state'],
] as const;

/**
 * 攻撃者が自分のアカウントで OAuth を開始して得た state 付きの同意 URL を、未ログインの被害者に踏ませる
 * ログイン CSRF。被害者のブラウザには state の Cookie が無いので、Cookie との照合で必ず止める。
 */
describe('OAuth callback は state の Cookie が無いか一致しないときに拒否する', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('COOKIE_SECRET', COOKIE_SECRET);
    vi.stubEnv('GOOGLE_SEARCH_CONSOLE_REDIRECT_URI', 'http://localhost/api/gsc/oauth/callback');
    vi.stubEnv('WORDPRESS_COM_CLIENT_ID', 'client-id');
    vi.stubEnv('WORDPRESS_COM_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('WORDPRESS_COM_REDIRECT_URI', 'http://localhost/api/wordpress/oauth/callback');
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.authMiddleware.mockResolvedValue({ lineUserId: '', userId: '', error: 'unauthenticated' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(CALLBACKS)('%s: Cookie が無ければ、署名が正しい state でもトークン交換へ進まない', async (_label, path, handler, _cookieName) => {
    const { state } = generateOAuthState(ATTACKER_USER_ID, COOKIE_SECRET);

    const response = await handler(callbackRequest(path, state));

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.authMiddleware).not.toHaveBeenCalled();
  });

  it.each(CALLBACKS)('%s: Cookie の state と一致しなければ拒否する', async (_label, path, handler, cookieName) => {
    const { state } = generateOAuthState(ATTACKER_USER_ID, COOKIE_SECRET);
    const { state: otherState } = generateOAuthState(ATTACKER_USER_ID, COOKIE_SECRET);

    const response = await handler(callbackRequest(path, state, `${cookieName}=${otherState}`));

    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
