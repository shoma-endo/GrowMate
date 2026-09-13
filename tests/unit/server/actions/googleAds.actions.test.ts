import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

/**
 * getGoogleAdsConnectionStatus / fetchKeywordMetrics / fetchCampaignMetrics の
 * トークンrefresh失敗時の分類の検証。
 *
 * 要点: googleTokenService.refreshAccessToken は 5xx/429 でも 400/401 でも同じ文言
 * （`Google OAuthトークンリフレッシュに失敗しました: Status {code}`）を投げるため、
 * ステータスコードで「本当の認証失効」と「一時的な失敗」を区別できているかを固定する。
 * 区別を誤ると、一時的な失敗（ネットワーク/レート制限/DB書き込み失敗）のたびに
 * マイホームへ「再連携が必要」の誤表示が出る（本バグの再発防止）。
 */

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getGoogleAdsCredential: vi.fn(),
  saveGoogleAdsCredential: vi.fn(),
  refreshAccessToken: vi.fn(),
  getKeywordMetrics: vi.fn(),
  getCampaignMetrics: vi.fn(),
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
    getGoogleAdsCredential = mocks.getGoogleAdsCredential;
    saveGoogleAdsCredential = mocks.saveGoogleAdsCredential;
  },
}));

vi.mock('@/server/services/googleAdsService', () => ({
  GoogleAdsService: class {
    refreshAccessToken = mocks.refreshAccessToken;
    getKeywordMetrics = mocks.getKeywordMetrics;
    getCampaignMetrics = mocks.getCampaignMetrics;
  },
}));

import {
  getGoogleAdsConnectionStatus,
  fetchKeywordMetrics,
  fetchCampaignMetrics,
} from '@/server/actions/googleAds.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

// googleTokenService.refreshAccessToken が実際に投げる文言（ステータス別）
const authExpired400 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 400');
const unauthorized401 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 401');
const forbidden403 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 403');
const rateLimited429 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 429');
const serverError500 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 500');
const networkError = new Error('fetch failed');
const invalidGrantNoStatus = new Error('invalid_grant: Token has been expired or revoked.');

const CREDENTIAL = {
  accessToken: 'old-token',
  accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(), // 期限切れ扱い
  refreshToken: 'refresh-token',
  googleAccountEmail: 'user@example.com',
  customerId: '1234567890',
  managerCustomerId: null,
  scope: ['https://www.googleapis.com/auth/adwords'],
};

describe('getGoogleAdsConnectionStatus のリフレッシュ失敗分類', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    mocks.getGoogleAdsCredential.mockResolvedValue(CREDENTIAL);
  });

  it('refreshToken が無ければ再認証要（回帰確認）', async () => {
    mocks.getGoogleAdsCredential.mockResolvedValue({ ...CREDENTIAL, refreshToken: null });

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
  });

  it('refresh成功・DB保存失敗は一時的失敗（needsReauthにしない）', async () => {
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 });
    mocks.saveGoogleAdsCredential.mockResolvedValue({ success: false });

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(false);
    expect(result.connected).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });

  it.each([
    ['400', authExpired400],
    ['401', unauthorized401],
    ['403', forbidden403],
  ])('refresh失敗 status %s は再認証要', async (_label, error) => {
    mocks.refreshAccessToken.mockRejectedValue(error);

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
  });

  it.each([
    ['429', rateLimited429],
    ['500', serverError500],
  ])('refresh失敗 status %s は一時的失敗（needsReauthにしない）', async (_label, error) => {
    mocks.refreshAccessToken.mockRejectedValue(error);

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(false);
    expect(result.connected).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });

  it('ステータスの取れないネットワーク例外は一時的失敗として扱う', async () => {
    mocks.refreshAccessToken.mockRejectedValue(networkError);

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });

  it('ステータスが無くても invalid_grant を含めば再認証要（フォールバック確認）', async () => {
    mocks.refreshAccessToken.mockRejectedValue(invalidGrantNoStatus);

    const result = await getGoogleAdsConnectionStatus();

    expect(result.needsReauth).toBe(true);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
  });
});

describe('fetchKeywordMetrics のリフレッシュ失敗分類', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    mocks.getGoogleAdsCredential.mockResolvedValue(CREDENTIAL);
  });

  it('DB保存失敗は一時的失敗メッセージ', async () => {
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 });
    mocks.saveGoogleAdsCredential.mockResolvedValue({ success: false });

    const result = await fetchKeywordMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });

  it('status 400 は再認証メッセージ', async () => {
    mocks.refreshAccessToken.mockRejectedValue(authExpired400);

    const result = await fetchKeywordMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
  });

  it('status 500 は一時的失敗メッセージ', async () => {
    mocks.refreshAccessToken.mockRejectedValue(serverError500);

    const result = await fetchKeywordMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });
});

describe('fetchCampaignMetrics のリフレッシュ失敗分類（catch引数追加の確認）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    mocks.getGoogleAdsCredential.mockResolvedValue(CREDENTIAL);
  });

  it('DB保存失敗は一時的失敗メッセージ', async () => {
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 });
    mocks.saveGoogleAdsCredential.mockResolvedValue({ success: false });

    const result = await fetchCampaignMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });

  it('status 400 は再認証メッセージ', async () => {
    mocks.refreshAccessToken.mockRejectedValue(authExpired400);

    const result = await fetchCampaignMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
  });

  it('status 429 は一時的失敗メッセージ', async () => {
    mocks.refreshAccessToken.mockRejectedValue(rateLimited429);

    const result = await fetchCampaignMetrics('2026-01-01', '2026-01-31');

    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_TEMPORARY_FAILURE);
  });
});
