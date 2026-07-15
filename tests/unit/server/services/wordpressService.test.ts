import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { WordPressService } from '@/server/services/wordpressService';

const createSelfHostedService = () =>
  new WordPressService({
    type: 'self_hosted',
    selfHostedAuth: {
      siteUrl: 'https://example.com',
      username: 'test-user',
      applicationPassword: 'test-password',
    },
  });

describe('WordPressService REST API fallback', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('セルフホストの投稿検索でwp-jsonが失敗した場合にrest_routeを試す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ ID: 42, slug: 'sample-post' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await createSelfHostedService().findExistingContent('sample-post');

    expect(result).toEqual({ success: true, data: { id: 42, slug: 'sample-post' } });
    expect(result.data).not.toHaveProperty('ID');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/wp-json/wp/v2/posts?slug=sample-post',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/index.php?rest_route=/wp/v2/posts&slug=sample-post',
      expect.any(Object)
    );
  });

  it('セルフホストのID取得でもrest_routeを試す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ID: 42, title: { rendered: '記事タイトル' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await createSelfHostedService().resolveContentById(42);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 42, title: { rendered: '記事タイトル' } });
    expect(result.data).not.toHaveProperty('ID');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://example.com/index.php?rest_route=/wp/v2/posts/42&_embed=true',
      expect.any(Object)
    );
  });

  it('WordPress標準のJSON 404はフォールバックせず固定ページ検索へ進む', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'rest_post_invalid_id' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ID: 42, title: { rendered: '固定ページ' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    const result = await createSelfHostedService().resolveContentById(42);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 42, title: { rendered: '固定ページ' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/wp-json/wp/v2/pages/42?_embed=true',
      expect.any(Object)
    );
  });

  it('小文字idのレスポンスも内部形式のidとして返す', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 42, slug: 'sample-post' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await createSelfHostedService().findExistingContent('sample-post');

    expect(result).toEqual({ success: true, data: { id: 42, slug: 'sample-post' } });
    expect(result.data).not.toHaveProperty('ID');
  });

  it('WordPress.comではフォールバックせず安全な403メッセージを返す', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    );
    const service = new WordPressService({ accessToken: 'test-token', siteId: 'example.com' });

    const result = await service.findExistingContent('sample-post');

    expect(result).toEqual({
      success: false,
      error: `投稿検索エラー (sample-post): ${ERROR_MESSAGES.WORDPRESS.REST_API_ACCESS_DENIED}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
