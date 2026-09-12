import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * マイホームでの GSC/GA4 トークンリフレッシュ分類の検証。
 *
 * 要点: 実際に ensureValidAccessToken（本物の実装）を通してリフレッシュを試み、
 * 失敗時に isGoogleOAuthReauthError で「本当の認証失効」と「一時的な失敗」を
 * 区別できているかを固定する。区別を誤ると、一時的な失敗（Google側5xx/429・
 * ネットワーク・DB書き込み失敗）のたびにマイホームへ「再連携が必要」の誤表示が
 * 出る（バグの再発防止）。ensureValidAccessToken 自体はモックせず本物を使う。
 */

const mocks = vi.hoisted(() => ({
  getGscCredentialByUserId: vi.fn(),
  updateGscCredential: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('server-only', () => ({}));

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

import { resolveHomeGoogleCredential } from '@/server/lib/home-google-credential';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

const authExpired400 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 400');
const rateLimited429 = new Error('Google OAuthトークンリフレッシュに失敗しました: Status 429');
const networkError = new Error('fetch failed');
const invalidGrantNoStatus = new Error('invalid_grant: Token has been expired or revoked.');

const baseCredential = {
  id: 'cred-1',
  userId: USER_ID,
  refreshToken: 'refresh-token',
  accessToken: 'old-token',
  scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
  googleAccountEmail: 'user@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const expiredCredential = {
  ...baseCredential,
  accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
};

const validCredential = {
  ...baseCredential,
  accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
};

describe('resolveHomeGoogleCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未連携なら unconnected、refresh/update は呼ばれない', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(null);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'unconnected' });
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(mocks.updateGscCredential).not.toHaveBeenCalled();
  });

  it('キャッシュが有効なら refresh/update を呼ばず元の credential を返す', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(validCredential);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'ok', credential: validCredential });
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
    expect(mocks.updateGscCredential).not.toHaveBeenCalled();
  });

  it('リフレッシュ成功時は新しい accessToken/expiresAt で更新した credential を返す', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockResolvedValue({
      accessToken: 'new-token',
      expiresIn: 3600,
      scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    mocks.updateGscCredential.mockResolvedValue(undefined);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.credential.accessToken).toBe('new-token');
      expect(result.credential.accessTokenExpiresAt).not.toBe(expiredCredential.accessTokenExpiresAt);
    }
    expect(mocks.updateGscCredential).toHaveBeenCalledTimes(1);
    const [userId, updates] = mocks.updateGscCredential.mock.calls[0]!;
    expect(userId).toBe(USER_ID);
    expect(updates.accessToken).toBe('new-token');
  });

  it('リフレッシュ応答に scope が無ければ既存 scope を保持する（消してはいけない）', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 });
    mocks.updateGscCredential.mockResolvedValue(undefined);

    const result = await resolveHomeGoogleCredential(USER_ID);

    const [, updates] = mocks.updateGscCredential.mock.calls[0]!;
    expect(updates.scope).toEqual(expiredCredential.scope);
    if (result.kind === 'ok') {
      expect(result.credential.scope).toEqual(expiredCredential.scope);
    }
  });

  it('リフレッシュ失敗 status 400 は古い credential のまま ok を返す（needsReauth は下流で自然に立つ）', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockRejectedValue(authExpired400);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'ok', credential: expiredCredential });
    expect(mocks.updateGscCredential).not.toHaveBeenCalled();
  });

  it('リフレッシュ失敗 status 429 は一時的失敗', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockRejectedValue(rateLimited429);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'transient_failure' });
  });

  it('ステータスの取れないネットワーク例外は一時的失敗', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockRejectedValue(networkError);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'transient_failure' });
  });

  it('ステータスが無くても invalid_grant を含めば再認証要（古い credential のまま）', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockRejectedValue(invalidGrantNoStatus);

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'ok', credential: expiredCredential });
  });

  it('リフレッシュは成功したが DB 保存が失敗したら一時的失敗', async () => {
    mocks.getGscCredentialByUserId.mockResolvedValue(expiredCredential);
    mocks.refreshAccessToken.mockResolvedValue({ accessToken: 'new-token', expiresIn: 3600 });
    mocks.updateGscCredential.mockRejectedValue(new Error('Google Search Console資格情報の更新に失敗しました'));

    const result = await resolveHomeGoogleCredential(USER_ID);

    expect(result).toEqual({ kind: 'transient_failure' });
  });
});
