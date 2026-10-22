import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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

import { getWordPressSettings, updateContentAnnotationFields } from '@/server/actions/wordpress.actions';

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

describe('getWordPressSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ブラウザへ渡す設定に、パスワード・トークン・クライアントシークレットを入れない', async () => {
    mocks.getWordPressSettingsByUserId.mockResolvedValue({
      id: 'settings-id',
      userId: 'user-id',
      wpType: 'self_hosted',
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'admin',
      wpApplicationPassword: 'app-password-secret',
      wpClientSecret: 'client-secret',
      wpAccessToken: 'access-token',
      wpRefreshToken: 'refresh-token',
      wpContentTypes: ['posts'],
    });

    const settings = await getWordPressSettings();

    expect(settings).toMatchObject({
      wpType: 'self_hosted',
      wpSiteUrl: 'https://blog.example.com',
      wpUsername: 'admin',
      hasApplicationPassword: true,
    });
    const serialized = JSON.stringify(settings);
    for (const secret of ['app-password-secret', 'client-secret', 'access-token', 'refresh-token']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('WordPress.com 型の設定に残っているパスワードは、保存済みとして扱わない', async () => {
    mocks.getWordPressSettingsByUserId.mockResolvedValue({
      id: 'settings-id',
      userId: 'user-id',
      wpType: 'wordpress_com',
      wpSiteId: '123',
      wpApplicationPassword: 'leftover-password',
    });

    const settings = await getWordPressSettings();

    expect(settings?.hasApplicationPassword).toBe(false);
  });
});
