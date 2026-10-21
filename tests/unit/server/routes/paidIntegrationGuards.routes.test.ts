import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getWordPressSettingsByUserId: vi.fn(),
  createOrUpdateSelfHostedWordPressSettings: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/server/lib/public-url-guard', () => ({
  checkPublicHttpsUrl: vi.fn(async (url: string) => ({ ok: true, url: new URL(url) })),
}));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  nextJson409IfEmailLinkConflict: () => null,
  nextResponseRedirectLoginIfEmailLinkConflict: () => null,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getWordPressSettingsByUserId = mocks.getWordPressSettingsByUserId;
    createOrUpdateSelfHostedWordPressSettings = mocks.createOrUpdateSelfHostedWordPressSettings;
  },
}));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GET as startGscOAuth } from '../../../../app/api/gsc/oauth/start/route';
import { POST as saveWordPressSettings } from '../../../../app/api/wordpress/settings/route';
import {
  GET as getWordPressConnection,
  POST as postWordPressConnection,
} from '../../../../app/api/wordpress/test-connection/route';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

function signInAs(role: 'trial' | 'paid') {
  mocks.authMiddleware.mockResolvedValue({ lineUserId: '', userId: USER_ID, userDetails: { role } });
}

function wordPressSettingsRequest() {
  return new NextRequest('http://localhost/api/wordpress/settings', {
    method: 'POST',
    body: JSON.stringify({
      wpType: 'self_hosted',
      wpSiteUrl: 'https://example.com',
      wpUsername: 'user',
      wpApplicationPassword: 'app-password',
    }),
  });
}

describe('GSC・WordPress 連携の Route Handler は trial を 403 で拒否する', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_SEARCH_CONSOLE_REDIRECT_URI', 'http://localhost/api/gsc/oauth/callback');
    vi.stubEnv('COOKIE_SECRET', 'cookie-secret-for-test-cookie-secret');
    mocks.getWordPressSettingsByUserId.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('trial は GSC の OAuth を開始できない', async () => {
    signInAs('trial');

    const response = await startGscOAuth(new NextRequest('http://localhost/api/gsc/oauth/start'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED });
  });

  it('paid は GSC の OAuth 開始で Google の同意画面へ送られる', async () => {
    signInAs('paid');

    const response = await startGscOAuth(new NextRequest('http://localhost/api/gsc/oauth/start'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it('trial は WordPress 設定を保存できない', async () => {
    signInAs('trial');

    const response = await saveWordPressSettings(wordPressSettingsRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: ERROR_MESSAGES.AUTH.UNAUTHORIZED,
    });
    expect(mocks.createOrUpdateSelfHostedWordPressSettings).not.toHaveBeenCalled();
  });

  it('trial は WordPress 接続確認（GET / POST）を使えず、設定を読まない', async () => {
    signInAs('trial');
    const request = () => new NextRequest('http://localhost/api/wordpress/test-connection');

    const getResponse = await getWordPressConnection(request());
    const postResponse = await postWordPressConnection(request());

    expect(getResponse.status).toBe(403);
    expect(await getResponse.json()).toEqual({
      success: false,
      connected: false,
      message: ERROR_MESSAGES.AUTH.UNAUTHORIZED,
    });
    expect(postResponse.status).toBe(403);
    expect(await postResponse.json()).toEqual({
      success: false,
      error: ERROR_MESSAGES.AUTH.UNAUTHORIZED,
    });
    expect(mocks.getWordPressSettingsByUserId).not.toHaveBeenCalled();
  });

  it('paid は WordPress 設定を保存できる', async () => {
    signInAs('paid');

    const response = await saveWordPressSettings(wordPressSettingsRequest());

    expect(response.status).toBe(200);
    expect(mocks.createOrUpdateSelfHostedWordPressSettings).toHaveBeenCalledOnce();
  });
});
