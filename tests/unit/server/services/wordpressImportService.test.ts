import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(result).toMatchObject({ kind: 'success', stats: { totalPosts: 1, updatedPosts: 1 } });
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

    expect(result.kind).toBe('success');
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
  it('初回の全件取得で記事が多いとき、新規は500件ずつ upsert し、既存の更新は同時20件までに抑える', async () => {
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

    expect(upsertSizes).toEqual([500, 500, 1]);
    expect(maxInFlight).toBe(20);
    expect(result).toMatchObject({
      kind: 'success',
      stats: { insertedPosts: newCount, updatedPosts: existingCount },
    });
  });
  it('新規の upsert が途中のバッチで失敗したら、既存の更新と基準の更新をせずに失敗を返す', async () => {
    const upsertSizes: number[] = [];
    const update = vi.fn();
    const advanceBaseline = vi.fn();
    const client = {
      from: () => ({
        upsert: (rows: unknown[]) => {
          upsertSizes.push(rows.length);
          const error = upsertSizes.length === 2 ? { message: 'payload too large' } : null;
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
    expect(upsertSizes).toEqual([500, 500]);
    expect(update).not.toHaveBeenCalled();
    expect(advanceBaseline).not.toHaveBeenCalled();
  });
});
