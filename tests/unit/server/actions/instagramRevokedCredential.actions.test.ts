import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 認可解除を検知したときに credential の期限を落とす処理の検証。
 *
 * 要点は「落としてよい場合」と「落としてはいけない場合」の切り分け。
 * 期限を過去へ倒すと resolveInstagramTokenAction がリフレッシュを試みなくなるため、
 * レート制限のような一時的な OAuthException で倒すと有効なトークンを恒久的に殺す。
 */

const mocks = vi.hoisted(() => ({
  getInstagramCredential: vi.fn(),
  updateInstagramCredential: vi.fn(),
  fetchProfile: vi.fn(),
  fetchMedia: vi.fn(),
  fetchMediaInsights: vi.fn(),
  ensureValidInstagramToken: vi.fn(),
  authMiddleware: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  // 競合なしのときは null を返す実装。ここで値を返すと認証段階で早期 return する。
  emailLinkConflictErrorPayload: () => null,
}));

vi.mock('@/server/lib/instagram-permissions', () => ({
  canAccessInstagram: () => true,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getInstagramCredential = mocks.getInstagramCredential;
    updateInstagramCredential = mocks.updateInstagramCredential;
  },
}));

vi.mock('@/server/services/instagramService', () => ({
  InstagramService: class {
    fetchProfile = mocks.fetchProfile;
    fetchMedia = mocks.fetchMedia;
    fetchMediaInsights = mocks.fetchMediaInsights;
    toMediaPreview = vi.fn();
  },
}));

vi.mock('@/server/services/instagramTokenService', () => ({
  ensureValidInstagramToken: mocks.ensureValidInstagramToken,
  createInstagramTokenDeps: vi.fn(),
}));

import { fetchInstagramPreviewData } from '@/server/actions/instagramSetup.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

// 2026-08-02 に実測した、認可解除済みトークンでの応答
const REVOKED = new Error(
  'Instagram API error: HTTP 400 {"error":{"message":"Error validating access token: The user has not authorized application.","type":"OAuthException","code":190,"error_subcode":458}}'
);

// レート制限。type は同じ OAuthException だが失効ではない
const RATE_LIMITED = new Error(
  'Instagram API error: HTTP 400 {"error":{"message":"Application request limit reached","type":"OAuthException","code":4}}'
);

describe('fetchInstagramPreviewData の認可解除検知', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      userId: USER_ID,
      userDetails: { role: 'paid' },
    });
    mocks.getInstagramCredential.mockResolvedValue({
      accessToken: 'stored-token',
      accessTokenExpiresAt: '2026-10-01T00:00:00.000Z',
      accessTokenIssuedAt: '2026-08-01T00:00:00.000Z',
    });
    mocks.ensureValidInstagramToken.mockResolvedValue({
      accessToken: 'stored-token',
      needsReauth: false,
    });
    mocks.updateInstagramCredential.mockResolvedValue({ success: true });
  });

  it('失効エラーなら期限を現在時刻へ落とす', async () => {
    mocks.fetchProfile.mockRejectedValue(REVOKED);

    const result = await fetchInstagramPreviewData();

    expect(result.success).toBe(false);
    expect(result.needsReauth).toBe(true);
    expect(mocks.updateInstagramCredential).toHaveBeenCalledTimes(1);

    const [userId, updates] = mocks.updateInstagramCredential.mock.calls[0]!;
    expect(userId).toBe(USER_ID);
    // 落とす先は「現在時刻」。過去でも未来でもなく、isInstagramTokenExpired の
    // 60秒マージンで即座に期限切れと判定される値であること。
    expect(Object.keys(updates)).toEqual(['accessTokenExpiresAt']);
    const written = new Date(updates.accessTokenExpiresAt as string).getTime();
    expect(Math.abs(written - Date.now())).toBeLessThan(5000);
  });

  it('レート制限では期限を落とさない（有効なトークンを殺さない）', async () => {
    mocks.fetchProfile.mockRejectedValue(RATE_LIMITED);

    const result = await fetchInstagramPreviewData();

    // 表示は再認証を促す側に倒れるが、DB は書き換えない。
    // 次回読み込みで自然に回復できる状態を保つ。
    expect(result.needsReauth).toBe(true);
    expect(mocks.updateInstagramCredential).not.toHaveBeenCalled();
  });

  it('投稿インサイトの失効エラーでも期限を落とす', async () => {
    mocks.fetchProfile.mockResolvedValue({ username: 'manbou536' });
    mocks.fetchMedia.mockResolvedValue([
      { id: '1', media_product_type: 'FEED', timestamp: '2026-08-02T00:00:00+0000' },
    ]);
    mocks.fetchMediaInsights.mockRejectedValue(REVOKED);

    const result = await fetchInstagramPreviewData();

    expect(result.needsReauth).toBe(true);
    expect(mocks.updateInstagramCredential).toHaveBeenCalledTimes(1);
  });

  it('保存済み期限が既に過去なら書き込まない（/setup と既に一致しているため）', async () => {
    mocks.ensureValidInstagramToken.mockResolvedValue({ needsReauth: true });

    const result = await fetchInstagramPreviewData();

    expect(result.needsReauth).toBe(true);
    expect(mocks.updateInstagramCredential).not.toHaveBeenCalled();
  });

  it('期限の書き込みに失敗してもレスポンスは変えない', async () => {
    mocks.fetchProfile.mockRejectedValue(REVOKED);
    mocks.updateInstagramCredential.mockResolvedValue({
      success: false,
      error: { developerMessage: 'RLS denied' },
    });

    const result = await fetchInstagramPreviewData();

    expect(result.success).toBe(false);
    expect(result.needsReauth).toBe(true);
  });
});
