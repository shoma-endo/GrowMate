import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWordPressSettingsByUserId: vi.fn(),
  refreshWpComToken: vi.fn(),
  buildWordPressServiceFromSettings: vi.fn(),
  findExistingContent: vi.fn(),
  resolveContentById: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getWordPressSettingsByUserId = mocks.getWordPressSettingsByUserId;
    refreshWpComToken = mocks.refreshWpComToken;

    getClient() {
      const query = {
        update: mocks.update,
        eq: mocks.eq,
      };
      mocks.update.mockReturnValue(query);
      mocks.eq.mockReturnValue(query);
      mocks.from.mockReturnValue(query);
      return { from: mocks.from };
    }
  },
}));

vi.mock('@/server/services/wordpressContext', () => ({
  WPCOM_TOKEN_COOKIE_NAME: 'wpcom_oauth_token',
  buildWordPressServiceFromSettings: mocks.buildWordPressServiceFromSettings,
}));

import { fetchWpPostContentLive } from '@/server/services/wordpressContentSync';

describe('fetchWpPostContentLive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWordPressSettingsByUserId.mockResolvedValue({
      wpType: 'self_hosted',
      wpSiteUrl: 'https://example.com',
    });
    mocks.buildWordPressServiceFromSettings.mockReturnValue({
      success: true,
      service: {
        findExistingContent: mocks.findExistingContent,
        resolveContentById: mocks.resolveContentById,
      },
    });
    mocks.resolveContentById.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        title: { rendered: '記事タイトル' },
        content: { rendered: '<h2>見出し</h2><p>記事本文</p>' },
        excerpt: { rendered: '抜粋' },
      },
    });
  });

  it('正規化済みidからcanonical URLのみの記事の投稿IDを解決する', async () => {
    mocks.findExistingContent.mockResolvedValue({
      success: true,
      data: { id: 42, slug: 'sample-post' },
    });

    const result = await fetchWpPostContentLive({
      userId: 'user-id',
      wpPostId: null,
      canonicalUrl: 'https://example.com/sample-post/',
      getCookie: () => undefined,
    });

    expect(mocks.resolveContentById).toHaveBeenCalledWith(42);
    expect(result).toEqual({
      contentText: '見出し  記事本文',
      contentHtml: '<h2>見出し</h2><p>記事本文</p>',
      title: '記事タイトル',
      excerpt: '抜粋',
    });
  });

  it('WordPress.comの保存トークンが無効でも有効なCookieで本文を取得する', async () => {
    mocks.getWordPressSettingsByUserId.mockResolvedValue({
      wpType: 'wordpress_com',
      wpSiteId: 'example.wordpress.com',
      wpAccessToken: 'expired-stored-token',
      wpTokenExpiresAt: '2000-01-01T00:00:00.000Z',
    });
    mocks.buildWordPressServiceFromSettings.mockImplementation((_settings, getCookie) => {
      expect(getCookie('wpcom_oauth_token')).toBe('valid-cookie-token');
      return {
        success: true,
        service: {
          findExistingContent: mocks.findExistingContent,
          resolveContentById: mocks.resolveContentById,
        },
      };
    });

    const result = await fetchWpPostContentLive({
      userId: 'user-id',
      wpPostId: 42,
      canonicalUrl: 'https://example.wordpress.com/sample-post/',
      getCookie: name =>
        name === 'wpcom_oauth_token' ? 'valid-cookie-token' : undefined,
    });

    expect(mocks.refreshWpComToken).not.toHaveBeenCalled();
    expect(mocks.resolveContentById).toHaveBeenCalledWith(42);
    expect(result?.contentText).toBe('見出し  記事本文');
  });
});
