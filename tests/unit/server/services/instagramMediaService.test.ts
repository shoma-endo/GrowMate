import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { clientMock } = vi.hoisted(() => ({
  clientMock: { from: vi.fn() },
}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => clientMock,
    }),
  },
}));

import { instagramMediaService } from '@/server/services/instagramMediaService';

function queryBuilder(response: { data: unknown[]; count: number; error: null }) {
  const builder = {
    calls: [] as unknown[][],
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then: undefined as unknown,
  } as Record<string, any>;

  for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range']) {
    builder[method].mockImplementation((...args: unknown[]) => {
      builder.calls.push([method, ...args]);
      return builder;
    });
  }
  builder.then = (
    resolve: (value: typeof response) => unknown,
    reject: (error: unknown) => unknown
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    ig_media_id: 'media-1',
    media_type: 'IMAGE',
    media_product_type: 'FEED',
    caption: null,
    media_url: null,
    thumbnail_url: null,
    permalink: 'https://instagram.com/p/media-1',
    posted_at: '2026-09-20T00:00:00.000Z',
    like_count: 10,
    comments_count: 2,
    reach: 100,
    views: null,
    saved: 3,
    engagement_rate: 15,
    like_rate: '10',
    saved_rate: 3,
    share_rate: null,
    comment_rate: 2,
    repost_rate: null,
    shares: null,
    total_interactions: null,
    reposts: null,
    reels_skip_rate: null,
    avg_watch_time_ms: null,
    total_watch_time_ms: null,
    insights_synced_at: null,
    insights_unavailable: false,
    insights_unavailable_reason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InstagramMediaService.getPage', () => {
  it('エンゲージメント率で並べ替え、目標下限を DB に渡す', async () => {
    const query = queryBuilder({ data: [mediaRow()], count: 1, error: null });
    clientMock.from.mockReturnValue(query);

    const result = await instagramMediaService.getPage('user-1', {
      page: 1,
      perPage: 10,
      type: 'all',
      startDate: null,
      endDate: null,
      sort: 'engagement_rate',
      order: 'desc',
      minEngagementRate: 4,
    });

    expect(result.items[0]?.engagementRate).toBe(15);
    // numeric 列が文字列で返っても数値へ揃える
    expect(result.items[0]?.likeRate).toBe(10);
    expect(result.items[0]?.shareRate).toBeNull();
    expect(result.items[0]?.repostRate).toBeNull();
    expect(query.calls).toContainEqual(['gte', 'engagement_rate', 4]);
    expect(query.calls).toContainEqual([
      'order',
      'engagement_rate',
      { ascending: false, nullsFirst: false },
    ]);
  });

  it('目標下限が null のときは率の絞り込みを追加しない', async () => {
    // like_rate: undefined は率の列のマイグレーションが未適用の DB を表す
    const query = queryBuilder({
      data: [mediaRow({ engagement_rate: null, like_rate: undefined })],
      count: 1,
      error: null,
    });
    clientMock.from.mockReturnValue(query);

    const result = await instagramMediaService.getPage('user-1', {
      page: 1,
      perPage: 10,
      type: 'all',
      startDate: null,
      endDate: null,
      sort: 'posted_at',
      order: 'desc',
      minEngagementRate: null,
    });

    expect(result.items[0]?.engagementRate).toBeNull();
    expect(result.items[0]?.likeRate).toBeNull();
    expect(query.calls.some((call: unknown[]) => call[0] === 'gte')).toBe(false);
  });

  // インサイト由来の列は対象外（insights_unavailable）を末尾へ寄せ、未取得（null）は昇順でも末尾。
  // 投稿の属性の列は寄せない。posted_at は索引と同じ並び（nullsFirst 指定なし）。同順位は id で固定する
  it.each([
    [
      'like_count',
      'asc',
      [
        ['order', 'insights_unavailable', { ascending: true }],
        ['order', 'like_count', { ascending: true, nullsFirst: false }],
      ],
    ],
    [
      'like_rate',
      'desc',
      [
        ['order', 'insights_unavailable', { ascending: true }],
        ['order', 'like_rate', { ascending: false, nullsFirst: false }],
      ],
    ],
    ['posted_at', 'desc', [['order', 'posted_at', { ascending: false }]]],
    ['caption', 'desc', [['order', 'caption', { ascending: false, nullsFirst: false }]]],
    [
      'media_product_type',
      'desc',
      [['order', 'media_product_type', { ascending: false, nullsFirst: false }]],
    ],
  ] as const)('%s（%s）の並び順', async (sort, order, expectedOrders) => {
    const query = queryBuilder({ data: [mediaRow()], count: 1, error: null });
    clientMock.from.mockReturnValue(query);

    await instagramMediaService.getPage('user-1', {
      page: 1,
      perPage: 10,
      type: 'all',
      startDate: null,
      endDate: null,
      sort,
      order,
      minEngagementRate: null,
    });

    const orders = query.calls.filter((call: unknown[]) => call[0] === 'order');
    expect(orders).toEqual([...expectedOrders, ['order', 'id', { ascending: true }]]);
  });
});
