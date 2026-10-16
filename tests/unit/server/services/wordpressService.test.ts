/**
 * @/server/services/wordpressService
 *
 * REST API のフォールバック経路と、一覧応答の正規化。
 * 元は同一モジュールの検査が2ファイルに分かれていた。
 * どちらの検査かは外側の describe が示す。
 * fetch のスタブは describe 内に閉じているため、もう一方へ漏れない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { WordPressImportDeadlineError, WordPressRestFetchError, WordPressService } from '@/server/services/wordpressService';
import { normalizeWordPressRestPosts } from '@/server/services/wordpressService';

describe('WordPressService（REST API フォールバック）', () => {
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

    it.each([
      {
        label: '投稿検索',
        call: (service: WordPressService) => service.findExistingContent('sample-post'),
        body: [{ ID: 42, slug: 'sample-post' }],
        expectedData: { id: 42, slug: 'sample-post' },
        expectedUrls: [
          'https://example.com/wp-json/wp/v2/posts?slug=sample-post',
          'https://example.com/index.php?rest_route=/wp/v2/posts&slug=sample-post',
        ],
      },
      {
        label: 'ID取得',
        call: (service: WordPressService) => service.resolveContentById(42),
        body: { ID: 42, title: { rendered: '記事タイトル' } },
        expectedData: { id: 42, title: { rendered: '記事タイトル' } },
        expectedUrls: [
          expect.any(String),
          'https://example.com/index.php?rest_route=/wp/v2/posts/42&_embed=true',
        ],
      },
    ])('セルフホストの$labelでwp-jsonが失敗した場合にrest_routeを試す', async ({ call, body, expectedData, expectedUrls }) => {
      fetchMock
        .mockResolvedValueOnce(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );

      const result = await call(createSelfHostedService());

      expect(result).toEqual({ success: true, data: expectedData });
      expect(result.data).not.toHaveProperty('ID');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expectedUrls);
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
});

describe('WordPress一覧差分取得（auto-daily-imports-spec FR-003）', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const service = () => new WordPressService({
    type: 'self_hosted',
    selfHostedAuth: { siteUrl: 'https://example.com', username: 'test', applicationPassword: 'secret' },
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('modified_after と after を +00:00 付きでクエリにする', async () => {
    fetchMock.mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': '0' },
    }));
    await service().fetchRestCollection('posts', 1, 100, {
      modifiedAfter: '2026-10-13T02:00:00+00:00',
      after: '2026-10-13T02:00:00+00:00',
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('modified_after')).toBe('2026-10-13T02:00:00+00:00');
    expect(url.searchParams.get('after')).toBe('2026-10-13T02:00:00+00:00');
    expect(url.searchParams.get('orderby')).toBe('id');
    expect(url.searchParams.get('order')).toBe('asc');
  });

  it('要求した投稿タイプごとに、ページ間で重複した記事 ID を除いて数える（id / ID の両方）', async () => {
    const page = (posts: unknown[]) => new Response(JSON.stringify(posts), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': '3' },
    });
    fetchMock
      .mockResolvedValueOnce(page([{ id: 1, type: 'product' }, { ID: 2, type: 'product' }]))
      .mockResolvedValueOnce(page([{ id: 2, type: 'product' }, { id: 3, type: 'product' }]));

    const result = await service().fetchAllContentByTypes(['products'], { perPage: 2 });

    expect(result.totalsByType).toEqual({ products: 3 });
    expect(result.uniqueIdCountsByType).toEqual({ products: 3 });
    expect(result.posts).toHaveLength(4);
  });

  it('全件取得をページごとに正規化し、件数の集計は生の記事 ID で行う', async () => {
    const page = (posts: unknown[]) => new Response(JSON.stringify(posts), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': '3' },
    });
    fetchMock
      .mockResolvedValueOnce(page([
        { id: 1, type: 'post', link: 'https://example.com/a', content: { rendered: '<p>本文A</p><img src="a.jpg">' } },
        { id: 2, type: 'post', link: 'https://example.com/b', content: { rendered: '<p>本文B</p>' } },
      ]))
      .mockResolvedValueOnce(page([
        { id: 3, type: 'post', link: 'https://example.com/c', content: { rendered: '<p>本文C</p>' } },
      ]));

    const result = await service().fetchAllNormalizedContentByTypes(['posts'], { perPage: 2 });

    expect(result.totalsByType).toEqual({ posts: 3 });
    expect(result.uniqueIdCountsByType).toEqual({ posts: 3 });
    expect(result.posts.map(post => [post.id, post.content_text, post.image_count])).toEqual([
      [1, '本文A', 1],
      [2, '本文B', 0],
      [3, '本文C', 0],
    ]);
    expect(result.posts[0]).not.toHaveProperty('content');
  });

  it('各ページの取得にタイムアウトの signal を付ける', async () => {
    fetchMock.mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': '0' },
    }));
    await service().fetchRestCollection('posts', 1, 100);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('締め切りを過ぎていたら、次のページを取らずに WordPressImportDeadlineError で打ち切る', async () => {
    const page = (ids: number[]) => new Response(JSON.stringify(ids.map(id => ({ id, type: 'post' }))), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': '4' },
    });
    fetchMock.mockResolvedValueOnce(page([1, 2]));
    // 1ページ目（ページ前・候補前・応答待ちの上限の計算）は締め切り前、2ページ目の前で過ぎる
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(2000);

    await expect(service().fetchAllNormalizedContentByTypes(['posts'], { perPage: 2, deadlineAt: 2000 }))
      .rejects.toBeInstanceOf(WordPressImportDeadlineError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('応答待ちのタイムアウトは status 0 として次の候補へ進み、全候補が失敗したら例外にまとめる', async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(service().fetchRestCollection('posts', 1, 100)).rejects.toMatchObject({
      statuses: [0, 0],
    } satisfies Partial<WordPressRestFetchError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('候補 URL を試す途中で締め切りを過ぎたら、次の候補を試さずに打ち切る', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(9000);

    await expect(service().fetchRestCollection('posts', 1, 100, { deadlineAt: 5000 }))
      .rejects.toBeInstanceOf(WordPressImportDeadlineError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('最後の候補の応答待ちを締め切りで打ち切ったときは、取得の失敗ではなく締め切りとして返す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    // 1つ目と2つ目の候補の前は締め切り前、ループを抜けた時点で過ぎている
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(5000);

    await expect(service().fetchRestCollection('posts', 1, 100, { deadlineAt: 5000 }))
      .rejects.toBeInstanceOf(WordPressImportDeadlineError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('失敗した候補の status をすべて例外へ残す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(service().fetchRestCollection('posts', 1, 100)).rejects.toMatchObject({
      statuses: [401, 404],
    } satisfies Partial<WordPressRestFetchError>);
  });
});

describe('normalizeWordPressRestPosts', () => {
  describe('normalizeWordPressRestPosts の本文抽出', () => {
    it('content.rendered から平文と img タグ数を取り出す', () => {
      const [normalized] = normalizeWordPressRestPosts([
        {
          id: 1,
          link: 'https://example.com/a',
          content: {
            rendered:
              '<p>本文です</p><img src="a.jpg" alt="1"><figure><IMG SRC="b.jpg"></figure><p>続き</p>',
          },
        },
      ]);

      // stripHtml はタグを空白へ置換するだけなので連続空白は残る。
      // 文字数採点は countContentChars 側で空白を畳むため、既存の
      // wordpressContentSync.extractPostFields と同じ形で保存する。
      expect(normalized?.content_text).toBe('本文です      続き');
      expect(normalized?.image_count).toBe(2);
    });

    it('画像が無い本文では image_count が 0 になる（未取得の NULL と区別できる）', () => {
      const [normalized] = normalizeWordPressRestPosts([
        { id: 2, link: 'https://example.com/b', content: { rendered: '<p>画像なし</p>' } },
      ]);

      expect(normalized?.content_text).toBe('画像なし');
      expect(normalized?.image_count).toBe(0);
    });

    it('content 自体が無いレスポンスでは両方 undefined のままにする', () => {
      const [normalized] = normalizeWordPressRestPosts([
        { id: 3, link: 'https://example.com/c' },
      ]);

      expect(normalized?.content_text).toBeUndefined();
      expect(normalized?.image_count).toBeUndefined();
    });

    it('本文が空タグだけなら content_text は落とし、image_count は 0 を返す', () => {
      const [normalized] = normalizeWordPressRestPosts([
        { id: 4, link: 'https://example.com/d', content: { rendered: '<p></p>' } },
      ]);

      expect(normalized?.content_text).toBeUndefined();
      expect(normalized?.image_count).toBe(0);
    });
  });
});
