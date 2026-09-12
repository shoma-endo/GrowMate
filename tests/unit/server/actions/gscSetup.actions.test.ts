import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * fetchGscProperties のトークンrefresh失敗分類の検証。
 *
 * 要点: googleTokenService.refreshAccessToken は 5xx/429 でも 400/401 でも同じ文言
 * （`Google OAuthトークンリフレッシュに失敗しました: Status {code}`）を投げるため、
 * isGoogleOAuthReauthError（ステータスコード優先）で正しく分類できているかを固定する。
 * 区別を誤ると、一時的な失敗のたびに /setup/gsc へ「要再認証」の誤表示が出る。
 */

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getGscCredentialByUserId: vi.fn(),
  updateGscCredential: vi.fn(),
  refreshAccessToken: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  emailLinkConflictErrorPayload: () => null,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getGscCredentialByUserId = mocks.getGscCredentialByUserId;
    updateGscCredential = mocks.updateGscCredential;
  },
}));

vi.mock('@/server/services/gscService', () => ({
  GscService: class {
    refreshAccessToken = mocks.refreshAccessToken;
    listSites = mocks.listSites;
  },
  formatGscPropertyDisplayName: (uri: string) => uri,
}));

import { fetchGscProperties } from '@/server/actions/gscSetup.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

const authExpired400 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 400');
const rateLimited429 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 429');
const serverError500 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 500');

const EXPIRED_CREDENTIAL = {
  id: 'cred-1',
  userId: USER_ID,
  refreshToken: 'refresh-token',
  accessToken: 'old-token',
  accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
  googleAccountEmail: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_CREDENTIAL = {
  ...EXPIRED_CREDENTIAL,
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
};

describe('fetchGscProperties のリフレッシュ失敗分類', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID });
    mocks.getGscCredentialByUserId.mockResolvedValue(EXPIRED_CREDENTIAL);
  });

  it('refresh失敗 status 400 は再認証要', async () => {
    mocks.refreshAccessToken.mockRejectedValue(authExpired400);

    const result = await fetchGscProperties();

    expect(result.success).toBe(false);
    expect('needsReauth' in result && result.needsReauth).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GSC.AUTH_EXPIRED_OR_REVOKED);
  });

  it.each([
    ['429', rateLimited429],
    ['500', serverError500],
  ])('refresh失敗 status %s は一時的失敗（needsReauthにしない）', async (_label, error) => {
    mocks.refreshAccessToken.mockRejectedValue(error);

    const result = await fetchGscProperties();

    expect(result.success).toBe(false);
    expect('needsReauth' in result ? result.needsReauth : undefined).toBeFalsy();
    expect(result.error).toBe(ERROR_MESSAGES.GSC.PROPERTIES_FETCH_FAILED);
  });

  it('listSites自体が実際のGSC 403文言で失敗しても再認証要にしない（権限系パターン追加による誤爆が無いことの回帰確認）', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(VALID_CREDENTIAL);
    mocks.listSites.mockRejectedValue(
      new Error(
        'Google Search Consoleサイト一覧の取得に失敗しました: 403 {"error":{"code":403,"message":"User does not have sufficient permission for site \'https://example.com/\'."}}'
      )
    );

    const result = await fetchGscProperties();

    expect(result.success).toBe(false);
    expect('needsReauth' in result ? result.needsReauth : undefined).toBeFalsy();
    expect(result.error).toBe(ERROR_MESSAGES.GSC.PROPERTIES_FETCH_FAILED);
  });
});
