import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return { rpc: mocks.rpc };
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
