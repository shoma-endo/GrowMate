/**
 * @/server/services/wordpressService
 *
 * REST API のフォールバック経路と、一覧応答の正規化。
 * 元は同一モジュールの検査が2ファイルに分かれていた。
 * どちらの検査かは外側の describe が示す。
 * fetch のスタブは describe 内に閉じているため、もう一方へ漏れない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// 接続先の検査は public-url-guard のテストで見る。ここでは global fetch へそのまま流す
const fetchPublicUrlMock = vi.hoisted(() => vi.fn((url: string, init?: RequestInit) => fetch(url, init)));
vi.mock('@/server/lib/public-url-guard', async importOriginal => ({
  ...(await importOriginal<typeof import('@/server/lib/public-url-guard')>()),
  fetchPublicUrl: fetchPublicUrlMock,
}));
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { WordPressImportDeadlineError, WordPressRestFetchError, WordPressService } from '@/server/services/wordpressService';
import { normalizeWordPressRestPosts } from '@/server/services/wordpressService';
import { PublicUrlBlockedError } from '@/server/lib/public-url-guard';

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

describe('WordPressService（投稿 API）', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const selfHostedService = () => new WordPressService({
    type: 'self_hosted',
    selfHostedAuth: { siteUrl: 'https://example.com', username: 'test-user', applicationPassword: 'test-password' },
  });
  const postResponse = () => new Response(JSON.stringify({
    id: 42,
    title: { raw: 'Title', rendered: 'Title' },
    status: 'draft',
    link: 'https://example.com/post',
    date_gmt: '2026-10-23T12:00:00',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['posts', 'pages'] as const)('$contentType を作成し、pagesにはcategoriesを送らない', async contentType => {
    fetchMock.mockResolvedValueOnce(postResponse());
    const result = await selfHostedService().createPost(contentType, {
      title: 'Title', content: '<p>Body</p>', status: 'draft', categories: [3], slug: 'title',
    });

    expect(result.id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://example.com/wp-json/wp/v2/${contentType}`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sentBody).toMatchObject({ title: 'Title', content: '<p>Body</p>', status: 'draft', slug: 'title' });
    if (contentType === 'posts') {
      expect(sentBody).toHaveProperty('categories', [3]);
    } else {
      expect(sentBody).not.toHaveProperty('categories');
    }
  });

  it.each(['posts', 'pages'] as const)('$contentType の投稿を指定 ID で更新する', async contentType => {
    fetchMock.mockResolvedValueOnce(postResponse());
    await selfHostedService().updatePost(contentType, 42, {
      title: 'Title', content: 'Body', status: 'publish', categories: [3],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`https://example.com/wp-json/wp/v2/${contentType}/42`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    if (contentType === 'pages') expect(body).not.toHaveProperty('categories');
    else expect(body).toHaveProperty('categories', [3]);
  });

  it('更新前の状態を context=edit で取得する', async () => {
    fetchMock.mockResolvedValueOnce(postResponse());
    await selfHostedService().fetchPost('posts', 42);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/wp-json/wp/v2/posts/42?context=edit');
  });

  it.each([
    { status: 403, body: '<h1>Forbidden</h1>', contentType: 'text/html', requests: 2 },
    { status: 404, body: 'Not Found', contentType: 'text/html', requests: 2 },
    { status: 403, body: JSON.stringify({ code: 'rest_cannot_create', message: 'Forbidden' }), contentType: 'application/json', requests: 1 },
    { status: 404, body: JSON.stringify({ code: 'rest_no_route', message: 'Not Found' }), contentType: 'application/json', requests: 1 },
    { status: 401, body: 'Unauthorized', contentType: 'text/html', requests: 1 },
    { status: 500, body: 'Server Error', contentType: 'text/html', requests: 1 },
    { status: 301, body: 'Moved', contentType: 'text/html', requests: 1 },
  ])('POST $status ($contentType) の再送条件を守る', async ({ status, body, contentType, requests }) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status, headers: { 'Content-Type': contentType } }));
    if (requests === 2) fetchMock.mockResolvedValueOnce(postResponse());

    if (requests === 1) {
      await expect(selfHostedService().createPost('posts', { title: 'T', content: 'C', status: 'draft' }))
        .rejects.toMatchObject({ status });
    } else {
      await selfHostedService().createPost('posts', { title: 'T', content: 'C', status: 'draft' });
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://example.com/index.php?rest_route=/wp/v2/posts');
    }
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  it.each([
    { status: 401, code: 'rest_not_logged_in' },
    { status: 403, code: 'rest_cannot_create' },
  ])('HTTP $status と WordPress code をエラーに保持する', async ({ status, code }) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code, message: 'Denied' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(selfHostedService().createPost('posts', { title: 'T', content: 'C', status: 'draft' }))
      .rejects.toMatchObject({ status, code, message: 'Denied' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('POST timeout を status 0 として返し、再送しない', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(selfHostedService().createPost('posts', { title: 'T', content: 'C', status: 'draft' }))
      .rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('カテゴリを名前順に最大5ページ取得し、超過を返す', async () => {
    for (let page = 1; page <= 5; page += 1) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: page, name: `Category ${page}` }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-WP-TotalPages': '6' },
      }));
    }
    const result = await selfHostedService().fetchCategories();

    expect(result).toEqual({
      categories: [1, 2, 3, 4, 5].map(id => ({ id, name: `Category ${id}` })),
      truncated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toBe('/wp-json/wp/v2/categories');
    expect(firstUrl.searchParams.get('per_page')).toBe('100');
    expect(firstUrl.searchParams.get('orderby')).toBe('name');
    expect(firstUrl.searchParams.get('order')).toBe('asc');
    expect(firstUrl.searchParams.get('page')).toBe('1');
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

  it('一覧のページが重くてサイト側が 5xx を返したら、件数を減らして同じ位置から取り直す', async () => {
    const page = (ids: number[], total: number) => new Response(JSON.stringify(ids.map(id => ({ id, type: 'page' }))), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WP-Total': String(total) },
    });
    fetchMock
      // 100件のページは wp-json と rest_route の両方で 500
      .mockResolvedValueOnce(new Response('Maximum execution time of 30 seconds exceeded', { status: 500 }))
      .mockResolvedValueOnce(new Response('Maximum execution time of 30 seconds exceeded', { status: 500 }))
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i + 1), 30))
      .mockResolvedValueOnce(page(Array.from({ length: 10 }, (_, i) => i + 21), 30));

    const result = await service().fetchAllContentByTypes(['pages'], { perPage: 100 });

    expect(result.posts).toHaveLength(30);
    expect(result.uniqueIdCountsByType).toEqual({ pages: 30 });
    const queried = fetchMock.mock.calls.map(([url]) => {
      const params = new URL(String(url)).searchParams;
      return [params.get('per_page'), params.get('page')];
    });
    expect(queried).toEqual([['100', '1'], ['100', '1'], ['20', '1'], ['20', '2']]);
  });

  it('片方の候補 URL だけが重さで失敗し、もう一方の形式がサイトで使えない（404）場合も、件数を減らして取り直す', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Maximum execution time of 30 seconds exceeded', { status: 500 }))
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, type: 'page' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-WP-Total': '1' },
      }));

    const result = await service().fetchAllContentByTypes(['pages'], { perPage: 100 });

    expect(result.posts).toHaveLength(1);
    expect(new URL(String(fetchMock.mock.calls[2]?.[0])).searchParams.get('per_page')).toBe('20');
  });

  it('投稿タイプの REST の入り口がサイトに無い（404 rest_no_route）ときは、そのタイプを飛ばして残りのタイプを取る', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const noRoute = () => new Response(JSON.stringify({ code: 'rest_no_route', data: { status: 404 } }), { status: 404 });
    fetchMock
      .mockResolvedValueOnce(noRoute())
      .mockResolvedValueOnce(noRoute())
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, type: 'post' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-WP-Total': '1' },
      }));

    const result = await service().fetchAllContentByTypes(['product', 'posts'], { perPage: 100 });

    expect(result.posts).toHaveLength(1);
    expect(result.totalsByType).toEqual({ product: 0, posts: 1 });
    expect(result.uniqueIdCountsByType).toEqual({ product: 0, posts: 1 });
    expect(result.missingRouteTypes).toEqual(['product']);
  });

  it('認証エラーは件数を減らしても変わらないので、取り直さずにそのまま失敗する', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(service().fetchAllContentByTypes(['posts'], { perPage: 100 })).rejects.toMatchObject({ statuses: [401, 401] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

describe('WordPressService（セルフホストの接続先の検査）', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const service = new WordPressService({
    type: 'self_hosted',
    selfHostedAuth: { siteUrl: 'https://internal.example.com', username: 'u', applicationPassword: 'p' },
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('セルフホストへの接続はすべて接続先を検査する経路を通り、内部アドレスなら接続テストは失敗を返す', async () => {
    fetchPublicUrlMock.mockRejectedValueOnce(new PublicUrlBlockedError('private_address'));

    const result = await service.testConnection();

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.SITE_URL_NOT_PUBLIC });
    expect(fetchPublicUrlMock).toHaveBeenCalledWith('https://internal.example.com/wp-json/', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('接続テストの失敗では、サイトの応答本文を画面向けのエラーに入れない', async () => {
    fetchMock.mockImplementation(async () => new Response('INTERNAL-SECRET-BODY', { status: 403 }));

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toContain('[reachability] HTTP 403');
    expect(result.error).not.toContain('INTERNAL-SECRET-BODY');
  });
});
