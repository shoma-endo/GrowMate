import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '@/server/services/supabaseService';
import type { WordPressService } from '@/server/services/wordpressService';
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
      fetchAllContentByTypes: vi.fn().mockResolvedValue({
        posts: [{ id: 1, type: postType, link: 'https://example.com/post', content: { rendered: '<p>Body</p>' } }],
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
});
