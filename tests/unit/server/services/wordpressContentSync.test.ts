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
  updateError: vi.fn(() => null as unknown),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getWordPressSettingsByUserId = mocks.getWordPressSettingsByUserId;
    refreshWpComToken = mocks.refreshWpComToken;

    getClient() {
      // 終端の eq() は PostgREST と同じく { data, error } に解決する thenable を返す。
      const query = {
        update: mocks.update,
        eq: mocks.eq,
        then: (resolve: (value: { data: null; error: unknown }) => unknown) =>
          Promise.resolve({ data: null, error: mocks.updateError() }).then(resolve),
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

import {
  fetchWpPostContentLive,
  fetchWpPostContentWithCache,
} from '@/server/services/wordpressContentSync';

describe('fetchWpPostContentLive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateError.mockReturnValue(null);
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
      imageCount: 0,
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

  it('本文・抜粋・タイトルがすべて空の取得結果では既存キャッシュを更新しない', async () => {
    mocks.resolveContentById.mockResolvedValue({
      success: true,
      data: {
        id: 42,
        title: { rendered: '' },
        content: { rendered: '' },
        excerpt: { rendered: '' },
      },
    });

    await fetchWpPostContentLive({
      userId: 'user-id',
      wpPostId: 42,
      canonicalUrl: 'https://example.com/sample-post/',
      getCookie: () => undefined,
    });

    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('キャッシュ更新が失敗してもログを残したうえで取得済み本文を返す', async () => {
    mocks.updateError.mockReturnValue({
      code: '42703',
      message: 'column "wp_image_count" does not exist',
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await fetchWpPostContentLive({
      userId: 'user-id',
      wpPostId: 42,
      canonicalUrl: 'https://example.com/sample-post/',
      getCookie: () => undefined,
    });

    expect(consoleError).toHaveBeenCalledWith(
      '[WordPressContentSync] updateContentCache failed',
      expect.objectContaining({ userId: 'user-id', wpPostId: 42, code: '42703' })
    );
    expect(result?.contentText).toBe('見出し  記事本文');

    consoleError.mockRestore();
  });
});

describe('fetchWpPostContentWithCache の再取得条件', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateError.mockReturnValue(null);
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
        content: { rendered: '<p>本文</p><img src="a.jpg">' },
        excerpt: { rendered: '抜粋' },
      },
    });
  });

  it('本文・抜粋が揃っていても画像点数が未取得なら取得し直して保存する', async () => {
    const result = await fetchWpPostContentWithCache({
      wpPostId: 42,
      cachedContent: 'キャッシュ済み本文',
      cachedExcerpt: 'キャッシュ済み抜粋',
      cachedImageCount: null,
      userId: 'user-id',
    });

    expect(mocks.resolveContentById).toHaveBeenCalledWith(42);
    expect(result?.imageCount).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ wp_image_count: 1 })
    );
  });

  it('本文・抜粋・画像点数がすべて揃っていれば WordPress を叩かない', async () => {
    const result = await fetchWpPostContentWithCache({
      wpPostId: 42,
      cachedContent: 'キャッシュ済み本文',
      cachedExcerpt: 'キャッシュ済み抜粋',
      cachedImageCount: 3,
      userId: 'user-id',
    });

    expect(mocks.resolveContentById).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      contentText: 'キャッシュ済み本文',
      title: null,
      excerpt: 'キャッシュ済み抜粋',
      imageCount: 3,
    });
  });

  it('画像点数が0で保存済みなら「未取得」と区別して再取得しない', async () => {
    const result = await fetchWpPostContentWithCache({
      wpPostId: 42,
      cachedContent: 'キャッシュ済み本文',
      cachedExcerpt: 'キャッシュ済み抜粋',
      cachedImageCount: 0,
      userId: 'user-id',
    });

    expect(mocks.resolveContentById).not.toHaveBeenCalled();
    expect(result?.imageCount).toBe(0);
  });
});
