import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  hasPaidFeatureAccess: vi.fn(),
  ownerRow: { id: 'annotation-1' } as unknown,
  from: vi.fn(),
  settings: null as { userId: string; wpType: string; wpAccessToken?: string } | null,
  defaults: null as unknown,
  getDefaults: vi.fn(),
  publish: vi.fn(),
  resolveToken: vi.fn(),
  buildService: vi.fn(),
  fetchPost: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  resolveAll: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/middleware/auth.middleware', () => ({ authMiddleware: mocks.auth }));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({ emailLinkConflictErrorPayload: () => null }));
vi.mock('@/types/user', () => ({ hasPaidFeatureAccess: mocks.hasPaidFeatureAccess }));
vi.mock('@/server/services/wordpressContentSync', () => ({ resolveWpComAccessToken: mocks.resolveToken }));
vi.mock('@/server/services/wordpressContext', () => ({ buildWordPressServiceFromSettings: mocks.buildService }));
vi.mock('@/server/services/analyticsContentService', () => ({ analyticsContentService: { resolveAllAnnotationIds: mocks.resolveAll } }));
vi.mock('@/server/services/wordpressPublishService', () => ({
  WordPressPublishService: class {
    getDefaults = mocks.getDefaults;
    publish = mocks.publish;
  },
}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: async () => ({ data: mocks.ownerRow, error: null }),
        then: (resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) =>
          Promise.resolve({ data: mocks.rows, error: null }).then(resolve),
      };
      mocks.from.mockReturnValue(query);
      return { from: mocks.from };
    }
    getWordPressSettingsByUserId = vi.fn(async () => mocks.settings);
  },
}));

import { getWordPressPublishDefaults, publishWordPressDraftsBulk } from '@/server/actions/wordpressPublish.actions';

describe('WordPress publish Server Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'user-1', userDetails: { role: 'admin' } });
    mocks.hasPaidFeatureAccess.mockReturnValue(true);
    mocks.ownerRow = { id: 'annotation-1' };
    mocks.rows = [];
    mocks.settings = { userId: 'user-1', wpType: 'self_hosted' };
    mocks.getDefaults.mockResolvedValue({
      annotationId: 'annotation-1', wpPostId: null, sessionId: 'session-1', title: 'Article',
      headingCount: 1, characterCount: 10, contentType: 'posts', status: 'draft',
      scheduledAt: null, storedStatus: null, categoryIds: [], content: '# Article',
    });
  });

  it('未連携なら初期値を取得せず、setup回復を返す', async () => {
    mocks.settings = null;

    const result = await getWordPressPublishDefaults({ annotationId: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002' });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_CONNECTED, recovery: 'setup' });
    expect(mocks.getDefaults).not.toHaveBeenCalled();
  });

  it('他人のannotationIdは拒否し、設定や記事本文を読まない', async () => {
    mocks.ownerRow = null;

    const result = await getWordPressPublishDefaults({ annotationId: '00000000-0000-4000-8000-000000000003', sessionId: '00000000-0000-4000-8000-000000000002' });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.getDefaults).not.toHaveBeenCalled();
  });

  it('trialロールの直接呼び出しを拒否し、DB・WordPressへ進まない', async () => {
    mocks.auth.mockResolvedValue({ userId: 'user-1', userDetails: { role: 'trial' } });
    mocks.hasPaidFeatureAccess.mockReturnValue(false);

    const result = await getWordPressPublishDefaults({ annotationId: '00000000-0000-4000-8000-000000000001' });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getDefaults).not.toHaveBeenCalled();
  });

  it('WordPress.comではトークン更新後にcookieを読まないgetterでRESTサービスを作る', async () => {
    mocks.settings = { userId: 'user-1', wpType: 'wordpress_com', wpAccessToken: 'old-token' };
    mocks.getDefaults.mockResolvedValue({
      annotationId: 'annotation-1', wpPostId: 77, sessionId: 'session-1', title: 'Article',
      headingCount: 1, characterCount: 10, contentType: 'posts', status: 'draft',
      scheduledAt: null, storedStatus: 'draft', categoryIds: [], content: '# Article',
    });
    mocks.resolveToken.mockResolvedValue({ accessToken: 'fresh-token' });
    mocks.buildService.mockReturnValue({ success: true, service: { fetchPost: mocks.fetchPost } });
    mocks.fetchPost.mockResolvedValue({ id: 77, title: 'Article', status: 'draft', link: 'https://example.com/article' });

    const result = await getWordPressPublishDefaults({ annotationId: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002' });

    expect(result).toMatchObject({ success: true, data: { wpPostId: 77, status: 'draft' } });
    expect(mocks.resolveToken).toHaveBeenCalledOnce();
    expect(mocks.settings.wpAccessToken).toBe('fresh-token');
    expect(mocks.buildService).toHaveBeenCalledWith(mocks.settings, expect.any(Function));
    expect(mocks.buildService.mock.calls[0]?.[1]('wpcom_oauth_token')).toBeUndefined();
  });

  it('WordPress側で公開済みでも保存状態を初期値にし、送信時の同期へ進める', async () => {
    mocks.getDefaults.mockResolvedValue({
      annotationId: 'annotation-1', wpPostId: 77, sessionId: 'session-1', title: 'Article',
      headingCount: 1, characterCount: 10, contentType: 'posts', status: 'draft',
      scheduledAt: null, storedStatus: 'draft', categoryIds: [], content: '# Article',
    });
    mocks.buildService.mockReturnValue({ success: true, service: { fetchPost: mocks.fetchPost } });
    mocks.fetchPost.mockResolvedValue({ id: 77, title: 'Live article', status: 'publish', link: 'https://example.com/live' });

    const result = await getWordPressPublishDefaults({ annotationId: '00000000-0000-4000-8000-000000000001' });

    expect(result).toMatchObject({ success: true, data: { status: 'draft', storedStatus: 'draft' } });
    expect(result).not.toHaveProperty('data.published');
  });

  it('一括下書きで予約・固定ページ・タイトル空を別の理由でスキップする', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
    ];
    mocks.rows = [
      { id: ids[0], session_id: 'session-1', wp_post_type: 'posts', wp_post_status: 'future', wp_post_id: 10 },
      { id: ids[1], session_id: 'session-2', wp_post_type: 'pages', wp_post_status: 'draft', wp_post_id: 11 },
      { id: ids[2], session_id: 'session-3', wp_post_type: 'posts', wp_post_status: 'draft', wp_post_id: 12 },
    ];
    mocks.getDefaults.mockResolvedValue({ title: '  ' });

    const result = await publishWordPressDraftsBulk({ mode: 'ids', contentAnnotationIds: ids });

    expect(result).toMatchObject({ success: true, data: { skipped: [
      { annotationId: ids[0], reason: ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_SCHEDULED },
      { annotationId: ids[1], reason: ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_OUT_OF_SCOPE },
      { annotationId: ids[2], reason: ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_TITLE_EMPTY },
    ] } });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('一括送信の期限到達後は未処理行をremainingに返し、次の送信を始めない', async () => {
    const ids = ['00000000-0000-4000-8000-000000000021'];
    mocks.rows = [{ id: ids[0], session_id: 'session-1', wp_post_type: 'posts', wp_post_status: 'draft', wp_post_id: null }];
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(650_000);

    const result = await publishWordPressDraftsBulk({ mode: 'ids', contentAnnotationIds: ids });

    expect(result).toMatchObject({ success: true, data: { successes: [], skipped: [], remaining: ids } });
    expect(mocks.getDefaults).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    now.mockRestore();
  });
});
