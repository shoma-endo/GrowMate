import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GA4_SCOPE } from '@/lib/constants';

/**
 * fetchGa4Properties / fetchGa4KeyEvents のトークンrefresh失敗分類の検証。
 *
 * 要点1: isGoogleOAuthReauthError（ステータスコード優先）で本当の認証失効と
 * 一時的な失敗（Google側5xx/429）を区別できているかを固定する。
 * 要点2: resolveGa4ActionContext は refresh を試みる前に role / scope をチェックする。
 * credential.scope に GA4_SCOPE が無いと SCOPE_MISSING で先に弾かれ、意図した
 * refresh失敗の分岐に到達しない（別の理由でテストが通ってしまう罠）ため、
 * フィクスチャには必ず GA4_SCOPE を含める。
 */

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getGscCredentialByUserId: vi.fn(),
  updateGscCredential: vi.fn(),
  refreshAccessToken: vi.fn(),
  listProperties: vi.fn(),
  listKeyEvents: vi.fn(),
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
  },
}));

vi.mock('@/server/services/ga4Service', () => ({
  Ga4Service: class {
    listProperties = mocks.listProperties;
    listKeyEvents = mocks.listKeyEvents;
  },
}));

import { fetchGa4Properties, fetchGa4KeyEvents, fetchGa4Status } from '@/server/actions/ga4Setup.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

const authExpired400 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 400');
const rateLimited429 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 429');
const serverError500 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 500');

const EXPIRED_CREDENTIAL_WITH_SCOPE = {
  id: 'cred-1',
  userId: USER_ID,
  refreshToken: 'refresh-token',
  accessToken: 'old-token',
  accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  scope: [GA4_SCOPE],
  googleAccountEmail: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('fetchGa4Properties / fetchGa4KeyEvents のリフレッシュ失敗分類', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    mocks.getGscCredentialByUserId.mockResolvedValue(EXPIRED_CREDENTIAL_WITH_SCOPE);
  });

  it('scope不足はGA4_SCOPEチェックで先に弾かれる（refreshに到達しないことの回帰確認）', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue({
      ...EXPIRED_CREDENTIAL_WITH_SCOPE,
      scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });

    const result = await fetchGa4Properties();

    expect(result.success).toBe(false);
    expect('needsReauth' in result && result.needsReauth).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GA4.SCOPE_MISSING);
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  describe('fetchGa4Properties', () => {
    it('refresh失敗 status 400 は再認証要', async () => {
      mocks.refreshAccessToken.mockRejectedValue(authExpired400);

      const result = await fetchGa4Properties();

      expect(result.success).toBe(false);
      expect('needsReauth' in result && result.needsReauth).toBe(true);
      expect(result.error).toBe(ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED);
    });

    it.each([
      ['429', rateLimited429],
      ['500', serverError500],
    ])('refresh失敗 status %s は一時的失敗（needsReauthにしない）', async (_label, error) => {
      mocks.refreshAccessToken.mockRejectedValue(error);

      const result = await fetchGa4Properties();

      expect(result.success).toBe(false);
      expect('needsReauth' in result ? result.needsReauth : undefined).toBeFalsy();
      expect(result.error).toBe(ERROR_MESSAGES.GA4.PROPERTIES_FETCH_FAILED);
    });
  });

  describe('fetchGa4KeyEvents', () => {
    it('refresh失敗 status 400 は再認証要', async () => {
      mocks.refreshAccessToken.mockRejectedValue(authExpired400);

      const result = await fetchGa4KeyEvents('properties/123');

      expect(result.success).toBe(false);
      expect('needsReauth' in result && result.needsReauth).toBe(true);
      expect(result.error).toBe(ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED);
    });

    it('refresh失敗 status 500 は一時的失敗（needsReauthにしない）', async () => {
      mocks.refreshAccessToken.mockRejectedValue(serverError500);

      const result = await fetchGa4KeyEvents('properties/123');

      expect(result.success).toBe(false);
      expect('needsReauth' in result ? result.needsReauth : undefined).toBeFalsy();
      expect(result.error).toBe(ERROR_MESSAGES.GA4.KEY_EVENTS_FETCH_FAILED);
    });
  });
});

/**
 * fetchGa4Status の再認証判定の検証（setup/GSCと同じ「1時間おきに再認証」誤表示バグの回帰確認。
 * GSC/GA4 は同一 credential 行を共有するため同じ欠陥が起きていた）。
 *
 * 要点: アクセストークンの期限切れ（約1時間TTL）だけを見て needsReauth を立てるのではなく、
 * resolveHomeGoogleCredential 経由で実際にリフレッシュを試みてから判定できているかを固定する。
 */
describe('fetchGa4Status の再認証判定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    mocks.getGscCredentialByUserId.mockResolvedValue(EXPIRED_CREDENTIAL_WITH_SCOPE);
  });

  it('アクセストークン期限切れでも refresh 成功なら needsReauth:false', async () => {
    mocks.refreshAccessToken.mockResolvedValue({
      accessToken: 'new-token',
      expiresIn: 3600,
      scope: EXPIRED_CREDENTIAL_WITH_SCOPE.scope,
    });
    mocks.updateGscCredential.mockResolvedValue(undefined);

    const result = await fetchGa4Status();

    expect(result.success).toBe(true);
    expect('data' in result ? result.data?.needsReauth : undefined).toBe(false);
  });

  it('refresh が 401 相当で失敗（本当の認証失効）なら needsReauth:true', async () => {
    mocks.refreshAccessToken.mockRejectedValue(authExpired400);

    const result = await fetchGa4Status();

    expect(result.success).toBe(true);
    expect('data' in result ? result.data?.needsReauth : undefined).toBe(true);
  });

  it('refresh が 429 等の一時的失敗なら、改修前と同じ生credentialベースの判定に落ちる（needsReauth:true のまま。専用の一時失敗表示は追加しない）', async () => {
    mocks.refreshAccessToken.mockRejectedValue(rateLimited429);

    const result = await fetchGa4Status();

    expect(result.success).toBe(true);
    expect('data' in result ? result.data?.needsReauth : undefined).toBe(true);
  });
});
