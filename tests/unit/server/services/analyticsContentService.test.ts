import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn(),
  not: vi.fn(),
  or: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: mocks.select,
        in: mocks.in,
        not: mocks.not,
        or: mocks.or,
        gte: mocks.gte,
        lte: mocks.lte,
      };
      mocks.select.mockReturnValue(query);
      mocks.in.mockReturnValue(query);
      mocks.or.mockReturnValue(query);
      mocks.gte.mockReturnValue(query);
      mocks.from.mockImplementation(() => query);
      return { rpc: mocks.rpc, from: mocks.from };
    }
  },
}));

import { analyticsContentService } from '@/server/services/analyticsContentService';

describe('analyticsContentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({
      data: [{ items: [], total_count: 0 }],
      error: null,
    });
    mocks.not.mockResolvedValue({
      data: [{ user_id: 'user-id', ga4_property_id: 'properties/123' }],
      error: null,
    });
    mocks.lte.mockResolvedValue({ data: [], error: null });
  });

  it('GA4集計の現状挙動を特性テストとして固定する', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          items: [
            { id: 'annotation-id', canonical_url: 'https://example.com/articles/one' },
            { id: 'annotation-without-url', canonical_url: null },
          ],
          total_count: 2,
        },
      ],
      error: null,
    });
    mocks.lte.mockResolvedValue({
      data: [
        {
          normalized_path: '/articles/one',
          sessions: 2,
          users: 3,
          engagement_time_sec: 20,
          bounce_rate: 0.25,
          engagement_rate: 0.4,
          active_users: 4,
          cv_event_count: 1,
          scroll_90_event_count: 2,
          search_clicks: 3,
          impressions: 10,
          ctr: 0.99,
          is_sampled: false,
          is_partial: true,
        },
        {
          normalized_path: '/articles/one',
          sessions: 8,
          users: 7,
          engagement_time_sec: 80,
          bounce_rate: 0.75,
          engagement_rate: 0.4,
          active_users: 4,
          cv_event_count: 4,
          scroll_90_event_count: 8,
          search_clicks: 2,
          impressions: 10,
          ctr: 0.01,
          is_sampled: true,
          is_partial: false,
        },
      ],
      error: null,
    });

    const result = await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    });

    expect(result.error).toBeUndefined();
    expect(result.items[0]?.ga4Summary).toEqual({
      normalizedPath: '/articles/one',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-08',
      sessions: 10,
      users: 10,
      engagementTimeSec: 100,
      bounceRate: 0.65,
      engagementRate: 0.4,
      activeUsers: 8,
      cvEventCount: 5,
      scroll90EventCount: 10,
      scrollMetricsAvailable: true,
      searchClicks: 5,
      impressions: 20,
      ctr: 0.25,
      isSampled: true,
      isPartial: true,
    });
    expect(result.items[1]?.ga4Summary).toBeNull();
    expect(mocks.or).toHaveBeenCalledWith(
      'and(user_id.eq.user-id,property_id.eq."properties/123")'
    );
  });

  it('GA4集計の分母0直帰率とCTR nullを固定する', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { items: [{ id: 'annotation-id', canonical_url: 'https://example.com/articles/one' }], total_count: 1 },
      ],
      error: null,
    });
    mocks.lte.mockResolvedValue({
      data: [
        {
          normalized_path: '/articles/one',
          sessions: 0,
          users: 0,
          engagement_time_sec: 0,
          bounce_rate: 0.8,
          engagement_rate: null,
          active_users: null,
          cv_event_count: 0,
          scroll_90_event_count: 0,
          search_clicks: 4,
          impressions: 0,
          ctr: 0.8,
          is_sampled: false,
          is_partial: false,
        },
      ],
      error: null,
    });

    const result = await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    });

    expect(result.items[0]?.ga4Summary?.bounceRate).toBe(0);
    expect(result.items[0]?.ga4Summary?.ctr).toBeNull();
  });

  it.each([
    {
      name: '日付未指定',
      startDate: '',
      endDate: '2026-08-08',
    },
    {
      name: '日付逆転',
      startDate: '2026-08-09',
      endDate: '2026-08-08',
    },
  ])('$nameではGA4クエリを発行せず空の集計を返す', async ({ startDate, endDate }) => {
    mocks.rpc.mockResolvedValue({
      data: [
        { items: [{ id: 'annotation-id', canonical_url: 'https://example.com/articles/one' }], total_count: 1 },
      ],
      error: null,
    });

    const result = await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate,
      endDate,
    });

    expect(result.items[0]?.ga4Summary).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('有効なcanonical_urlが0件ならGA4クエリを発行しない', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ items: [{ id: 'annotation-id', canonical_url: '   ' }], total_count: 1 }],
      error: null,
    });

    const result = await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    });

    expect(result.items[0]?.ga4Summary).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('GA4プロパティ未設定ならGA4クエリを発行せず空の集計を返す', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { items: [{ id: 'annotation-id', canonical_url: 'https://example.com/articles/one' }], total_count: 1 },
      ],
      error: null,
    });
    mocks.not.mockResolvedValue({ data: [], error: null });

    const result = await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    });

    expect(result.items[0]?.ga4Summary).toBeNull();
    expect(mocks.or).not.toHaveBeenCalled();
  });

  it('GSC評価未開始フィルターをRPCへ渡す', async () => {
    await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      hasUnstartedGscEvaluation: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('get_filtered_content_annotations', {
      p_user_id: 'user-id',
      p_page: 1,
      p_per_page: 10,
      p_selected_category_names: [],
      p_include_uncategorized: false,
      p_has_unread_suggestion: false,
      p_has_unstarted_gsc_evaluation: true,
      p_has_unstarted_ga4_evaluation: false,
    });
  });

  it('GSC評価未開始フィルター未指定時は無効値をRPCへ渡す', async () => {
    await analyticsContentService.getPage('user-id', {
      page: 1,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_filtered_content_annotations',
      expect.objectContaining({ p_has_unstarted_gsc_evaluation: false })
    );
  });

  it('カテゴリ・未読提案・GSC評価未開始の条件を同時にRPCへ渡す', async () => {
    await analyticsContentService.getPage('user-id', {
      page: 2,
      perPage: 10,
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      selectedCategoryNames: ['SEO'],
      includeUncategorized: true,
      hasUnreadSuggestion: true,
      hasUnstartedGscEvaluation: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_filtered_content_annotations',
      expect.objectContaining({
        p_page: 2,
        p_selected_category_names: ['SEO'],
        p_include_uncategorized: true,
        p_has_unread_suggestion: true,
        p_has_unstarted_gsc_evaluation: true,
      })
    );
  });
});
