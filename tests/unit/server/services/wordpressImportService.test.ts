import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { SupabaseService } from '@/server/services/supabaseService';
import { normalizeWordPressRestPosts, type WordPressService } from '@/server/services/wordpressService';
import type { WordPressSettings } from '@/types/wordpress';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return {
        from: () => ({
          update: mocks.update,
        }),
      };
    }
  },
}));

import { importWordPressContent } from '@/server/services/wordpressImportService';

describe('WordPress差分取込（auto-daily-imports-spec FR-003/FR-005）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  });

  it('既存記事の本文だけが変わった場合も更新し、成功後に開始時刻を基準にする', async () => {
    const advanceBaseline = vi.fn().mockResolvedValue(undefined);
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([
        { id: 'annotation-1', canonical_url: 'https://example.com/post', normalized_url: null, wp_post_id: 1 },
      ]),
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllContentByTypes: vi.fn().mockResolvedValue({
        posts: [{
          id: 1,
          type: 'post',
          link: 'https://example.com/post',
          title: { rendered: 'Title' },
          content: { rendered: '<p>Updated body</p>' },
          modified_gmt: '2026-10-14T01:00:00',
        }],
        totalsByType: { posts: 1 },
      }),
    } as unknown as WordPressService;
    const settings = {
      wpContentTypes: ['posts'],
      wpImportBaselineAt: '2026-10-13T00:00:00.000Z',
    } as WordPressSettings;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result.kind).toBe('success');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      wp_content_text: 'Updated body',
    }));
    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'id', 'annotation-1');
    expect(advanceBaseline).toHaveBeenCalledWith('user-1', '2026-10-14T02:00:00.000Z', {
      baselineAt: '2026-10-13T00:00:00.000Z',
      siteUrl: null,
      siteId: null,
    });
    expect(result).toMatchObject({ kind: 'success', stats: { isDiffImport: true, totalPosts: 1, updatedPosts: 1 } });
  });

  it.each([
    ['総数どおり取れた', 'posts', 'post', { posts: 1 }, { posts: 1 }, true],
    ['総数より少なかった', 'posts', 'post', { posts: 2 }, { posts: 1 }, false],
    // REST のパス名（products）と記事の type（product）が違うカスタム投稿タイプでも、要求したタイプ名で突き合わせる
    ['カスタム投稿タイプで総数どおり取れた', 'products', 'product', { products: 1 }, { products: 1 }, true],
  ])('初回の全件取得で%s場合、基準を進めるか判定する', async (
    _label, contentType, postType, totalsByType, uniqueIdCountsByType, shouldAdvance
  ) => {
    const advanceBaseline = vi.fn().mockResolvedValue(true);
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([
        { id: 'annotation-1', canonical_url: 'https://example.com/post', normalized_url: null, wp_post_id: 1 },
      ]),
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: normalizeWordPressRestPosts([{ id: 1, type: postType, link: 'https://example.com/post', content: { rendered: '<p>Body</p>' } }]),
        totalsByType,
        uniqueIdCountsByType,
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: {
        wpContentTypes: [contentType],
        wpImportBaselineAt: null,
        wpSiteUrl: 'https://example.com',
      } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'success', stats: { isDiffImport: false } });
    if (shouldAdvance) {
      expect(advanceBaseline).toHaveBeenCalledWith('user-1', '2026-10-14T02:00:00.000Z', {
        baselineAt: null,
        siteUrl: 'https://example.com',
        siteId: null,
      });
    } else {
      expect(advanceBaseline).not.toHaveBeenCalled();
    }
  });

  it('既存記事の更新に失敗した回は差分基準を進めない', async () => {
    const advanceBaseline = vi.fn();
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([
        { id: 'annotation-1', canonical_url: 'https://example.com/post', normalized_url: null, wp_post_id: 1 },
      ]),
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    mocks.eq.mockReturnValue({ eq: () => Promise.resolve({ error: { message: 'write failed' } }) });
    const wpService = {
      fetchAllContentByTypes: vi.fn().mockResolvedValue({
        posts: [{ id: 1, type: 'post', link: 'https://example.com/post', modified_gmt: '2026-10-14T01:00:00Z' }],
        totalsByType: { posts: 1 },
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: '2026-10-13T00:00:00.000Z' } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'failure', failure: 'temporary_failure' });
    expect(advanceBaseline).not.toHaveBeenCalled();
  });
  it('初回の全件取得で記事が多いとき、新規は100件ずつ upsert し、既存の更新は同時20件までに抑える', async () => {
    const existingCount = 45;
    const newCount = 1001;
    const upsertSizes: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
      from: () => ({
        upsert: (rows: Array<{ canonical_url: string }>) => {
          upsertSizes.push(rows.length);
          return {
            select: () => Promise.resolve({
              data: rows.map(row => ({ canonical_url: row.canonical_url, wp_post_title: 'Title' })),
              error: null,
            }),
          };
        },
        update: () => ({
          eq: () => ({
            eq: () => {
              inFlight += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              return new Promise(resolve => setTimeout(() => {
                inFlight -= 1;
                resolve({ error: null });
              }, 0));
            },
          }),
        }),
      }),
    };
    const supabaseService = {
      getClient: () => client,
      listContentAnnotationKeys: vi.fn().mockResolvedValue(Array.from({ length: existingCount }, (_, i) => ({
        id: `annotation-${i + 1}`,
        canonical_url: `https://example.com/p/${i + 1}`,
        normalized_url: null,
        wp_post_id: i + 1,
      }))),
      advanceWordPressImportBaseline: vi.fn().mockResolvedValue(true),
    } as unknown as SupabaseService;
    const total = existingCount + newCount;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: normalizeWordPressRestPosts(Array.from({ length: total }, (_, i) => ({
          id: i + 1,
          type: 'post',
          link: `https://example.com/p/${i + 1}`,
          title: { rendered: 'Title' },
        }))),
        totalsByType: { posts: total },
        uniqueIdCountsByType: { posts: total },
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(upsertSizes).toEqual([...Array<number>(10).fill(100), 1]);
    expect(maxInFlight).toBe(20);
    expect(result).toMatchObject({
      kind: 'success',
      stats: { insertedPosts: newCount, updatedPosts: existingCount },
    });
  });
  it('新規の upsert が途中のバッチで失敗したら、既存の更新と基準の更新をせずに失敗を返す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upsertSizes: number[] = [];
    const update = vi.fn();
    const advanceBaseline = vi.fn();
    const client = {
      from: () => ({
        upsert: (rows: unknown[]) => {
          upsertSizes.push(rows.length);
          const error = upsertSizes.length === 2
            ? { message: 'payload too large', code: '413', details: null, hint: null }
            : null;
          return { select: () => Promise.resolve({ data: error ? null : [], error }) };
        },
        update,
      }),
    };
    const supabaseService = {
      getClient: () => client,
      listContentAnnotationKeys: vi.fn().mockResolvedValue([
        { id: 'annotation-1', canonical_url: 'https://example.com/p/1', normalized_url: null, wp_post_id: 1 },
      ]),
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const total = 1201;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: normalizeWordPressRestPosts(Array.from({ length: total }, (_, i) => ({
          id: i + 1,
          type: 'post',
          link: `https://example.com/p/${i + 1}`,
          title: { rendered: 'Title' },
        }))),
        totalsByType: { posts: total },
        uniqueIdCountsByType: { posts: total },
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result.kind).toBe('failure');
    expect(upsertSizes).toEqual([100, 100]);
    // DB のエラーは Error ではないオブジェクトなので、中身を落とさずにログへ残す
    expect(consoleError).toHaveBeenCalledWith('[wordpress-import] import failed', expect.objectContaining({
      error: { message: 'payload too large', code: '413', details: null, hint: null },
    }));
    expect(update).not.toHaveBeenCalled();
    expect(advanceBaseline).not.toHaveBeenCalled();
  });
  it.each([
    ['前回の取込以降の記事が0件の差分取込', ['posts'], true],
    // 投稿タイプを自動検出した回は基準を捨てて全件取得になるので、差分取込ではない
    ['投稿タイプを自動検出した回', [], false],
  ])('%sでは isDiffImport を取得の方法どおりに返す', async (_label, wpContentTypes, expectedDiff) => {
    const fetchAll = vi.fn().mockResolvedValue({ posts: [], totalsByType: {}, uniqueIdCountsByType: {} });
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([]),
      updateWordPressContentTypes: vi.fn().mockResolvedValue(undefined),
      advanceWordPressImportBaseline: vi.fn().mockResolvedValue(true),
    } as unknown as SupabaseService;
    const wpService = {
      fetchAvailableContentTypes: vi.fn().mockResolvedValue({ success: true, data: ['posts'] }),
      fetchAllContentByTypes: fetchAll,
      fetchAllNormalizedContentByTypes: fetchAll,
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes, wpImportBaselineAt: '2026-10-13T00:00:00.000Z' } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'success', stats: { isDiffImport: expectedDiff, totalPosts: 0 } });
  });
  it('差分取込で WordPress が返した候補がすべて基準時刻以前なら、取得件数と「変更なし」の件数が一致する（画面の0件表示の条件）', async () => {
    const oldPost = {
      id: 1,
      type: 'post',
      link: 'https://example.com/old',
      modified_gmt: '2026-10-12T00:00:00',
      date_gmt: '2026-10-01T00:00:00',
    };
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([]),
      advanceWordPressImportBaseline: vi.fn().mockResolvedValue(true),
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllContentByTypes: vi.fn().mockResolvedValue({ posts: [oldPost], totalsByType: { posts: 1 }, uniqueIdCountsByType: { posts: 1 } }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: '2026-10-13T00:00:00.000Z' } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result).toMatchObject({
      kind: 'success',
      stats: { isDiffImport: true, totalPosts: 1, skippedExistingPosts: 1, newPosts: 0, updatedPosts: 0 },
    });
  });
  it('書き込みの途中で締め切りを過ぎたら、残りを書かずに一時的な失敗で終え、基準を進めない', async () => {
    const upsertSizes: number[] = [];
    const update = vi.fn();
    const advanceBaseline = vi.fn();
    const client = {
      from: () => ({
        upsert: (rows: Array<{ canonical_url: string }>) => {
          upsertSizes.push(rows.length);
          return { select: () => Promise.resolve({ data: rows.map(row => ({ canonical_url: row.canonical_url, wp_post_title: 'Title' })), error: null }) };
        },
        update,
      }),
    };
    const supabaseService = {
      getClient: () => client,
      listContentAnnotationKeys: vi.fn().mockResolvedValue([
        { id: 'annotation-1', canonical_url: 'https://example.com/p/1', normalized_url: null, wp_post_id: 1 },
      ]),
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const total = 1001;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: normalizeWordPressRestPosts(Array.from({ length: total }, (_, i) => ({
          id: i + 1,
          type: 'post',
          link: `https://example.com/p/${i + 1}`,
          title: { rendered: 'Title' },
        }))),
        totalsByType: { posts: total },
        uniqueIdCountsByType: { posts: total },
      }),
    } as unknown as WordPressService;
    // 取得後・キー読み込み後・1回目の新規書き込みの前は締め切り前、2回目の前で締め切りを過ぎる
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(5000);

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
      deadlineAt: 5000,
    });
    now.mockRestore();

    expect(result).toEqual({
      kind: 'failure',
      failure: 'temporary_failure',
      error: ERROR_MESSAGES.WORDPRESS.IMPORT_TIMED_OUT,
    });
    expect(upsertSizes).toEqual([100]);
    expect(update).not.toHaveBeenCalled();
    expect(advanceBaseline).not.toHaveBeenCalled();
    expect(wpService.fetchAllNormalizedContentByTypes).toHaveBeenCalledWith(['posts'], { perPage: 100, deadlineAt: 5000 });
  });
  it('投稿タイプの自動検出にも締め切りを渡し、締め切りで打ち切られたら時間切れの案内で終える', async () => {
    const { WordPressImportDeadlineError } = await import('@/server/services/wordpressService');
    const fetchAvailableContentTypes = vi.fn().mockRejectedValue(new WordPressImportDeadlineError());
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      advanceWordPressImportBaseline: vi.fn(),
    } as unknown as SupabaseService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: [], wpImportBaselineAt: null } as unknown as WordPressSettings,
      wpService: { fetchAvailableContentTypes } as unknown as WordPressService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
      deadlineAt: 5000,
    });

    expect(fetchAvailableContentTypes).toHaveBeenCalledWith(5000);
    expect(result).toEqual({ kind: 'failure', failure: 'temporary_failure', error: ERROR_MESSAGES.WORDPRESS.IMPORT_TIMED_OUT });
  });
  it('取得が締め切りの直前に終わったら、既存記事キーの読み込みに進まずに打ち切る', async () => {
    const listContentAnnotationKeys = vi.fn();
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      listContentAnnotationKeys,
      advanceWordPressImportBaseline: vi.fn(),
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({ posts: [], totalsByType: {}, uniqueIdCountsByType: {} }),
    } as unknown as WordPressService;
    const now = vi.spyOn(Date, 'now').mockReturnValue(5000);

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
      deadlineAt: 5000,
    });
    now.mockRestore();

    expect(listContentAnnotationKeys).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: 'failure', error: ERROR_MESSAGES.WORDPRESS.IMPORT_TIMED_OUT });
  });
  it('REST の入り口が無い投稿タイプは設定から外し、残りのタイプで全件取込を終えて基準を進める', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const updateWordPressContentTypes = vi.fn().mockResolvedValue(undefined);
    const advanceBaseline = vi.fn().mockResolvedValue(true);
    const supabaseService = {
      getClient: () => ({
        from: () => ({
          update: mocks.update,
          upsert: () => ({ select: () => Promise.resolve({ data: [{ canonical_url: 'https://example.com/a', wp_post_title: 'A' }], error: null }) }),
        }),
      }),
      listContentAnnotationKeys: vi.fn().mockResolvedValue([]),
      // 取込中に利用者が pages を足した。古い設定で上書きせず、今の設定から product だけを除く
      getWordPressSettingsByUserId: vi.fn().mockResolvedValue({ wpContentTypes: ['posts', 'pages', 'product'] }),
      updateWordPressContentTypes,
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: normalizeWordPressRestPosts([{ id: 1, type: 'post', link: 'https://example.com/a', title: { rendered: 'A' } }]),
        totalsByType: { posts: 1, product: 0 },
        uniqueIdCountsByType: { posts: 1, product: 0 },
        missingRouteTypes: ['product'],
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['posts', 'product'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(updateWordPressContentTypes).toHaveBeenCalledWith('user-1', ['posts', 'pages']);
    expect(advanceBaseline).toHaveBeenCalledWith('user-1', '2026-10-14T02:00:00.000Z', expect.objectContaining({ baselineAt: null }));
    expect(result).toMatchObject({ kind: 'success', stats: { contentTypes: ['posts'], insertedPosts: 1 } });
  });
  it('設定の投稿タイプがすべてサイトに無いときは、設定を空にせず一時的な失敗で終える', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const updateWordPressContentTypes = vi.fn();
    const advanceBaseline = vi.fn();
    const supabaseService = {
      getClient: () => ({ from: () => ({ update: mocks.update }) }),
      updateWordPressContentTypes,
      advanceWordPressImportBaseline: advanceBaseline,
    } as unknown as SupabaseService;
    const wpService = {
      fetchAllNormalizedContentByTypes: vi.fn().mockResolvedValue({
        posts: [], totalsByType: { product: 0 }, uniqueIdCountsByType: { product: 0 }, missingRouteTypes: ['product'],
      }),
    } as unknown as WordPressService;

    const result = await importWordPressContent({
      userId: 'user-1',
      settings: { wpContentTypes: ['product'], wpImportBaselineAt: null } as WordPressSettings,
      wpService,
      supabaseService,
      startedAt: '2026-10-14T02:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'failure', failure: 'temporary_failure' });
    expect(updateWordPressContentTypes).not.toHaveBeenCalled();
    expect(advanceBaseline).not.toHaveBeenCalled();
  });
});
