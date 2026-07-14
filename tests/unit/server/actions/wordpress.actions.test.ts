import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  getWordPressSettingsByUserId: vi.fn(),
}));

vi.mock('@/server/middleware/withAuth.middleware', () => ({
  withAuth: vi.fn(
    async (
      callback: (context: {
        userId: string;
        cookieStore: { get: (name: string) => { value: string } | undefined };
      }) => Promise<unknown>
    ) => callback({ userId: 'user-id', cookieStore: { get: () => undefined } })
  ),
  isWithAuthEmailLinkConflict: vi.fn(() => false),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: mocks.select,
        update: mocks.update,
        eq: mocks.eq,
        maybeSingle: mocks.maybeSingle,
      };
      mocks.select.mockReturnValue(query);
      mocks.update.mockReturnValue(query);
      mocks.eq.mockReturnValue(query);
      mocks.from.mockReturnValue(query);
      return { from: mocks.from };
    }

    getWordPressSettingsByUserId = mocks.getWordPressSettingsByUserId;
  },
}));

import { updateContentAnnotationFields } from '@/server/actions/wordpress.actions';

describe('updateContentAnnotationFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('保存済みURLが同一ならWordPressを再検索せず本人のレコードを更新する', async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: {
          canonical_url: 'https://example.com/sample-post/',
          wp_post_id: 42,
          wp_post_title: '記事タイトル',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'annotation-id' }, error: null });

    const result = await updateContentAnnotationFields('annotation-id', {
      canonical_url: 'https://example.com/sample-post/',
      main_kw: '更新後キーワード',
    });

    expect(result).toEqual({
      success: true,
      wp_post_id: 42,
      wp_post_title: '記事タイトル',
    });
    expect(mocks.getWordPressSettingsByUserId).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-id');
  });
});
