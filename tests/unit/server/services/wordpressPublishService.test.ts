import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { WordPressSettings } from '@/types/wordpress';

const mocks = vi.hoisted(() => ({
  client: undefined as unknown,
  createPost: vi.fn(),
  updatePost: vi.fn(),
  fetchPost: vi.fn(),
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return mocks.client as SupabaseClient;
    }
  },
}));
vi.mock('@/server/services/wordpressContext', () => ({
  buildWordPressServiceFromSettings: () => ({
    success: true,
    service: {
      createPost: mocks.createPost,
      updatePost: mocks.updatePost,
      fetchPost: mocks.fetchPost,
      fetchCategories: vi.fn(),
    },
  }),
}));
vi.mock('@/server/services/wordpressContentSync', () => ({ resolveWpComAccessToken: vi.fn() }));
vi.mock('@/lib/markdown-to-wordpress-html', () => ({ markdownToWordPressHtml: () => '<p>Article</p>' }));

import { WordPressPublishService } from '@/server/services/wordpressPublishService';
import { WordPressRestFetchError } from '@/server/services/wordpressService';

type QueryResult = { data: unknown; error: { message: string } | null };

class FakeQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly operation: 'select' | 'update',
    private readonly table: string,
    private readonly annotation: unknown,
    private readonly claimAcquired: boolean,
    private readonly updates: unknown[],
    private readonly filters: Record<string, unknown>,
    queries: Array<{ table: string; filters: Record<string, unknown> }>,
  ) { queries.push({ table, filters }); }

  select(): this { return this; }
  eq(column: string, value: unknown): this { this.filters[column] = value; return this; }
  is(): this { return this; }
  lt(): this { return this; }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve({
      data: this.operation === 'select'
        ? this.table === 'content_annotations'
          ? this.annotation
          : this.filters.session_id === 'another-users-session'
            ? { content: '# Foreign article' }
            : null
        : this.claimAcquired ? { id: 'annotation-1' } : null,
      error: null,
    });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.table === 'session_combined_contents' && this.filters.session_id === 'another-users-session'
      ? { content: '# Foreign article' }
      : null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function makeClient(claimAcquired: boolean, updates: unknown[], annotationOverrides: Record<string, unknown> = {}): SupabaseClient {
  const annotation = {
    id: 'annotation-1',
    user_id: 'user-1',
    session_id: 'session-1',
    wp_post_id: null,
    wp_post_type: null,
    wp_post_status: null,
    wp_categories: null,
    wp_category_names: null,
    ...annotationOverrides,
  };
  return {
    from: (table: string) => ({
      select: () => new FakeQuery('select', table, annotation, claimAcquired, updates, {}, mocks.queries),
      update: (value: unknown) => {
        updates.push(value);
        return new FakeQuery('update', table, annotation, claimAcquired, updates, {}, mocks.queries);
      },
    }),
  } as unknown as SupabaseClient;
}

const defaults = {
  annotationId: 'annotation-1',
  wpPostId: null,
  sessionId: 'session-1',
  content: '# Article\n\nBody',
  title: 'Article',
  headingCount: 1,
  characterCount: 15,
  contentType: 'posts' as const,
  status: 'draft' as const,
  scheduledAt: null,
  storedStatus: null,
  categoryIds: [],
};

describe('WordPressPublishService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queries = [];
    mocks.createPost.mockResolvedValue({ id: 123, status: 'draft', link: 'https://example.com/article', title: 'Article' });
    mocks.updatePost.mockResolvedValue({ id: 42, status: 'draft', link: 'https://example.com/article', title: 'Article' });
    mocks.fetchPost.mockResolvedValue({ id: 42, status: 'draft', link: 'https://example.com/article', title: 'Article' });
  });

  it('claimを取れた新規投稿だけをPOSTし、WordPressのIDを保存してclaimを外す', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates);
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue(defaults);

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1',
      title: 'Article',
      contentType: 'posts',
      status: 'draft',
    });

    expect(result).toMatchObject({ success: true, data: { outcome: 'sent', wpPostId: 123, status: 'draft' } });
    expect(mocks.createPost).toHaveBeenCalledOnce();
    expect(mocks.createPost).toHaveBeenCalledWith('posts', expect.objectContaining({ title: 'Article', status: 'draft' }));
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ wp_post_id: 123, wp_post_status: 'draft', canonical_url: null }),
      { wp_publish_claimed_at: null },
    ]));
  });

  it('claimを取れない新規投稿ではWordPressへPOSTしない', async () => {
    mocks.client = makeClient(false, []);
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue(defaults);

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1',
      title: 'Article',
      contentType: 'posts',
      status: 'draft',
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_IN_PROGRESS, recovery: 'close' });
    expect(mocks.createPost).not.toHaveBeenCalled();
  });

  it('WordPress側が公開済みならDBを同期してalready_publishedを返し、更新しない', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'posts', wp_post_status: 'draft' });
    mocks.fetchPost.mockResolvedValueOnce({
      id: 42,
      status: 'publish',
      link: 'https://example.com/live-article',
      title: { rendered: 'Live article title' },
    });
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, storedStatus: 'draft' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Article', contentType: 'posts', status: 'draft',
    });

    expect(result).toEqual({ success: true, data: {
      outcome: 'already_published', wpPostId: 42, status: 'publish', link: 'https://example.com/live-article',
    } });
    expect(updates).toContainEqual({
      wp_post_title: 'Live article title', wp_post_status: 'publish', canonical_url: 'https://example.com/live-article',
    });
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it('既存投稿の更新が公開状態で成功したらWordPressの応答をDBへ同期する', async () => {
    const updates: unknown[] = [];
    const link = 'https://example.com/published-article';
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'posts', wp_post_status: 'draft' });
    mocks.updatePost.mockResolvedValueOnce({
      id: 42,
      status: 'publish',
      link,
      title: { rendered: 'Title returned by WordPress' },
    });
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, storedStatus: 'draft' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Submitted title', contentType: 'posts', status: 'publish',
    });

    expect(result).toEqual({ success: true, data: { outcome: 'sent', wpPostId: 42, status: 'publish', link } });
    expect(mocks.updatePost).toHaveBeenCalledWith('posts', 42, expect.objectContaining({ title: 'Submitted title', status: 'publish' }));
    expect(updates).toContainEqual(expect.objectContaining({
      wp_post_id: 42,
      wp_post_title: 'Title returned by WordPress',
      wp_post_status: 'publish',
      canonical_url: link,
    }));
  });

  it('公開済み状態の行はWordPressを上書きしない', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'posts', wp_post_status: 'publish' });
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, storedStatus: 'publish' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Article', contentType: 'posts', status: 'draft',
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_ALREADY_PUBLISHED, recovery: 'close' });
    expect(mocks.fetchPost).not.toHaveBeenCalled();
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it('rest_post_invalid_idだけを解除し、投稿タイプを残して新規送信に戻す', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'pages', wp_post_status: 'draft' });
    mocks.fetchPost.mockRejectedValueOnce(new WordPressRestFetchError('Deleted', [404], 'rest_post_invalid_id'));
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, contentType: 'pages', storedStatus: 'draft' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Article', contentType: 'pages', status: 'draft',
    });

    expect(result).toEqual({
      success: false,
      error: 'WordPress 側で固定ページが削除されていました。もう一度送信すると新しい固定ページを作ります',
      recovery: 'resend',
    });
    expect(updates).toContainEqual({ wp_post_id: null, wp_post_title: null, wp_post_status: null });
    expect(updates).not.toContainEqual(expect.objectContaining({ wp_post_type: null }));
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it('別の404では紐づけを解除せず更新を止める', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'posts', wp_post_status: 'draft' });
    mocks.fetchPost.mockRejectedValueOnce(new WordPressRestFetchError('Not found', [404], 'rest_not_found'));
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, storedStatus: 'draft' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Article', contentType: 'posts', status: 'draft',
    });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_FOUND, recovery: 'retry' });
    expect(updates).not.toContainEqual(expect.objectContaining({ wp_post_id: null }));
    expect(mocks.updatePost).not.toHaveBeenCalled();
  });

  it('固定ページ更新では投稿カテゴリ列を書き換えない', async () => {
    const updates: unknown[] = [];
    mocks.client = makeClient(true, updates, { wp_post_id: 42, wp_post_type: 'pages', wp_post_status: 'draft' });
    const service = new WordPressPublishService();
    vi.spyOn(service, 'getDefaults').mockResolvedValue({ ...defaults, wpPostId: 42, contentType: 'pages', storedStatus: 'draft' });

    const result = await service.publish('user-1', { userId: 'user-1', wpType: 'self_hosted' }, () => undefined, {
      annotationId: 'annotation-1', title: 'Article', contentType: 'pages', status: 'draft',
    });

    expect(result).toMatchObject({ success: true, data: { outcome: 'sent' } });
    expect(mocks.updatePost).toHaveBeenCalledWith('pages', 42, expect.not.objectContaining({ categories: expect.anything() }));
    const saved = updates.find(value => typeof value === 'object' && value !== null && 'wp_post_id' in value) as Record<string, unknown>;
    expect(saved).not.toHaveProperty('wp_categories');
    expect(saved).not.toHaveProperty('wp_category_names');
  });

  it('annotationId指定時はNULLのsession_idを入力sessionIdで補完せず、他人の本文を照会しない', async () => {
    mocks.client = makeClient(true, [], { session_id: null });
    const service = new WordPressPublishService();

    await expect(service.getDefaults('user-1', 'annotation-1', 'another-users-session'))
      .resolves.toBeNull();
    expect(mocks.queries).not.toContainEqual(expect.objectContaining({
      table: 'session_combined_contents',
      filters: expect.objectContaining({ session_id: 'another-users-session' }),
    }));
  });
});
