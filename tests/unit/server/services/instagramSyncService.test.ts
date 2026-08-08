import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// instagramSyncService とその依存（instagramService 等）は `import 'server-only'` を持つ。
// vitest の node 環境では実体が throw するため、空モジュールに差し替える。
vi.mock('server-only', () => ({}));

// INSTAGRAM_SYNC_MEDIA_LIMIT を小さい値に固定し、複数バッチにまたがる backfill の
// ループ挙動を、50件分のフィクスチャを用意せずに検証できるようにする。
// 他の定数（レート閾値・時間予算等）は実値のまま使う。
vi.mock('@/lib/constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/constants')>();
  return { ...actual, INSTAGRAM_SYNC_MEDIA_LIMIT: 2 };
});

const fetchMediaPageMock = vi.fn();
const fetchMediaInsightsMock = vi.fn();
const fetchAccountInsightsDailyMock = vi.fn();

vi.mock('@/server/services/instagramService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/server/services/instagramService')>();
  return {
    ...actual,
    InstagramService: vi.fn().mockImplementation(function InstagramServiceMock() {
      return {
        fetchMediaPage: fetchMediaPageMock,
        fetchMediaInsights: fetchMediaInsightsMock,
        fetchAccountInsightsDaily: fetchAccountInsightsDailyMock,
      };
    }),
  };
});

const getInstagramCredentialMock = vi.fn();
const updateInstagramCredentialMock = vi.fn();

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: vi.fn().mockImplementation(function SupabaseServiceMock() {
    return {
      getInstagramCredential: getInstagramCredentialMock,
      updateInstagramCredential: updateInstagramCredentialMock,
    };
  }),
}));

const getLatestPostedAtMock = vi.fn();
const getExistingMediaIdsMock = vi.fn();
const getInsightsUnavailableMediaIdsMock = vi.fn();
const updateMediaListingFieldsMock = vi.fn();
const upsertMediaMock = vi.fn();
const upsertMediaInsightsUnavailableMock = vi.fn();
const upsertMediaListingPreservingInsightsMock = vi.fn();
const upsertAccountInsightsDailyMock = vi.fn();

vi.mock('@/server/services/instagramMediaService', () => ({
  instagramMediaService: {
    getLatestPostedAt: getLatestPostedAtMock,
    getExistingMediaIds: getExistingMediaIdsMock,
    getInsightsUnavailableMediaIds: getInsightsUnavailableMediaIdsMock,
    updateMediaListingFields: updateMediaListingFieldsMock,
    upsertMedia: upsertMediaMock,
    upsertMediaInsightsUnavailable: upsertMediaInsightsUnavailableMock,
    upsertMediaListingPreservingInsights: upsertMediaListingPreservingInsightsMock,
    upsertAccountInsightsDaily: upsertAccountInsightsDailyMock,
  },
}));

const { instagramSyncService } = await import('@/server/services/instagramSyncService');

const emptyUsage = {
  appUsage: { callCount: null, totalTime: null, totalCpuTime: null },
  bucUsage: null,
};

function mediaPage(items: unknown[], after: string | null = null) {
  return {
    usage: emptyUsage,
    data: {
      data: items,
      paging: after ? { cursors: { after } } : undefined,
    },
  };
}

function rawItem(id: string, timestamp: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    media_type: 'IMAGE',
    media_product_type: 'FEED',
    caption: null,
    media_url: `https://example.com/${id}.jpg`,
    thumbnail_url: null,
    permalink: `https://instagram.com/p/${id}`,
    timestamp,
    like_count: 1,
    comments_count: 0,
    ...overrides,
  };
}

const insights = {
  reach: 10,
  views: 20,
  likes: 1,
  comments: 0,
  saved: 0,
  shares: 0,
  totalInteractions: 1,
  reposts: null,
  reelsSkipRate: null,
  avgWatchTimeMs: null,
  totalWatchTimeMs: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getInsightsUnavailableMediaIdsMock.mockResolvedValue(new Set());
  fetchMediaInsightsMock.mockResolvedValue({ usage: emptyUsage, data: insights });
  updateInstagramCredentialMock.mockResolvedValue({ success: true });
  upsertMediaMock.mockResolvedValue(undefined);
  fetchAccountInsightsDailyMock.mockResolvedValue({ usage: emptyUsage, data: [] });
  upsertAccountInsightsDailyMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InstagramSyncService.syncUserData incremental', () => {
  it('初回同期（ウォーターマークなし）は取得した全件を同期する', async () => {
    getLatestPostedAtMock.mockResolvedValue(null);
    getInstagramCredentialMock.mockResolvedValue({ lastSyncedAt: null });
    fetchMediaPageMock.mockResolvedValueOnce(
      mediaPage(
        [rawItem('1', '2026-08-01T00:00:00+0000'), rawItem('2', '2026-08-02T00:00:00+0000')],
        null
      )
    );

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'incremental');

    expect(result.mode).toBe('incremental');
    expect(result.synced).toBe(2);
    expect(result.truncated).toBe(false);
    expect(updateInstagramCredentialMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ lastSyncedAt: expect.any(String) })
    );
  });

  it('ウォーターマーク以下の投稿に到達したらページングを打ち切り、新着のみ同期する', async () => {
    getLatestPostedAtMock.mockResolvedValue('2026-08-01T00:00:00.000Z');
    getInstagramCredentialMock.mockResolvedValue({ lastSyncedAt: '2026-08-01T00:00:00.000Z' });
    fetchMediaPageMock.mockResolvedValueOnce(
      mediaPage(
        [
          rawItem('3', '2026-08-03T00:00:00+0000'),
          rawItem('2', '2026-08-02T00:00:00+0000'),
          rawItem('1', '2026-08-01T00:00:00+0000'), // ウォーターマーク以下＝同期済み
        ],
        'cursor-2'
      )
    );

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'incremental');

    expect(result.synced).toBe(2); // id:3, id:2 のみ
    expect(fetchMediaPageMock).toHaveBeenCalledTimes(1); // ウォーターマーク到達で即打ち切り、2ページ目は取得しない
  });
});

describe('InstagramSyncService.syncUserData backfill', () => {
  it('既に backfillCompletedAt がある場合は API を叩かず即返す', async () => {
    getInstagramCredentialMock.mockResolvedValue({
      backfillCompletedAt: '2026-08-01T00:00:00.000Z',
      backfillCursor: null,
    });

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'backfill');

    expect(result.backfillCompleted).toBe(true);
    expect(fetchMediaPageMock).not.toHaveBeenCalled();
  });

  it('既存投稿はインサイト取得をスキップしつつページングを継続する', async () => {
    getInstagramCredentialMock.mockResolvedValue({ backfillCompletedAt: null, backfillCursor: null });
    fetchMediaPageMock.mockResolvedValueOnce(
      mediaPage(
        [
          rawItem('existing-1', '2026-07-01T00:00:00+0000'),
          rawItem('new-1', '2026-06-01T00:00:00+0000'),
        ],
        null
      )
    );
    getExistingMediaIdsMock.mockResolvedValue(new Set(['existing-1']));

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'backfill');

    expect(result.synced).toBe(1); // new-1 のみ
    expect(fetchMediaInsightsMock).toHaveBeenCalledTimes(1);
    expect(fetchMediaInsightsMock).toHaveBeenCalledWith('token', 'new-1', 'FEED');
  });

  it('アカウント末端（nextCursor=null）に到達したら backfillCompletedAt を保存する', async () => {
    getInstagramCredentialMock.mockResolvedValue({ backfillCompletedAt: null, backfillCursor: null });
    fetchMediaPageMock.mockResolvedValueOnce(
      mediaPage([rawItem('1', '2026-08-01T00:00:00+0000')], null)
    );
    getExistingMediaIdsMock.mockResolvedValue(new Set());

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'backfill');

    expect(result.backfillCompleted).toBe(true);
    expect(updateInstagramCredentialMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ backfillCompletedAt: expect.any(String), backfillCursor: null })
    );
    // backfill は lastSyncedAt を更新しない
    expect(updateInstagramCredentialMock).not.toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ lastSyncedAt: expect.any(String) })
    );
  });

  it('1バッチで件数上限に達した場合、次のバッチへ自動的に進み最終的に完了する（サーバー側で複数バッチを繰り返す）', async () => {
    getInstagramCredentialMock.mockResolvedValue({ backfillCompletedAt: null, backfillCursor: null });
    getExistingMediaIdsMock.mockResolvedValue(new Set());
    fetchMediaPageMock
      .mockResolvedValueOnce(
        mediaPage(
          [
            rawItem('1', '2026-08-03T00:00:00+0000'),
            rawItem('2', '2026-08-02T00:00:00+0000'),
            rawItem('3', '2026-08-01T00:00:00+0000'),
          ],
          'cursor-batch2'
        )
      )
      .mockResolvedValueOnce(mediaPage([rawItem('4', '2026-07-01T00:00:00+0000')], null));

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'backfill');

    // バッチ1: 3件中 INSTAGRAM_SYNC_MEDIA_LIMIT(モックで2に固定) 分だけ採用され truncated。
    // クライアントが再度ボタンを押すことなく、サーバー側でバッチ2へ自動的に進む。
    expect(fetchMediaPageMock).toHaveBeenCalledTimes(2);
    expect(result.synced).toBe(3); // バッチ1で2件 + バッチ2で1件
    expect(result.backfillCompleted).toBe(true);
    expect(updateInstagramCredentialMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ backfillCompletedAt: expect.any(String), backfillCursor: null })
    );
  });

  it('time_budget で中断した場合、続きのカーソルを保存し backfillCompleted は false のまま', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2026-08-08T00:00:00.000Z');
    vi.setSystemTime(startTime);

    getInstagramCredentialMock.mockResolvedValue({ backfillCompletedAt: null, backfillCursor: null });
    getExistingMediaIdsMock.mockResolvedValue(new Set());
    fetchMediaPageMock.mockImplementationOnce(async () => {
      // 予算(760秒)を超過させ、次の checkBudget() で time_budget 中断させる
      vi.setSystemTime(new Date(startTime.getTime() + 800_000));
      return mediaPage([rawItem('1', '2026-08-01T00:00:00+0000')], 'cursor-continue');
    });

    const result = await instagramSyncService.syncUserData('user-1', 'token', 'backfill');

    expect(result.stoppedReason).toBe('time_budget');
    expect(result.backfillCompleted).toBe(false);
    expect(updateInstagramCredentialMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ backfillCursor: 'cursor-continue' })
    );
  });
});
