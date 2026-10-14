import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ range: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({ range: mocks.range }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

describe('listContentAnnotationKeys pagination（auto-daily-imports-spec §9）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.range.mockImplementation((from: number) => Promise.resolve({
      data: from === 0
        ? Array.from({ length: 1000 }, (_, index) => ({
            id: `annotation-${index}`,
            canonical_url: null,
            normalized_url: null,
            wp_post_id: index,
          }))
        : [{ id: 'annotation-1000', canonical_url: null, normalized_url: null, wp_post_id: 1000 }],
      error: null,
      count: 1001,
    }));
  });

  it('1,001件目を含め、2ページ分を読む', async () => {
    const keys = await new SupabaseService().listContentAnnotationKeys('user-1');

    expect(keys).toHaveLength(1001);
    expect(keys.at(-1)?.id).toBe('annotation-1000');
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
