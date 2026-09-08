import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `createOrUpdateWordPressSettings` が、トークン未指定の呼び出しで
 * **保存済みトークンを消さない**ことを固定する。
 *
 * 設定画面からの保存（`saveWordPressSettingsAction` / `PUT /api/wordpress/settings`）は
 * 投稿タイプなどだけを渡してこの関数を呼ぶ。ここで token 列を null 上書きすると、
 * OAuth 済みの利用者が設定を保存しただけで保存済みトークンが消える。同期経路は
 * ブラウザの Cookie で動けるが、**cron は Cookie を持たない**ため、その利用者の
 * AI要約一括は全記事が再連携要求で失敗する。
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
}));

// supabaseService は 'server-only' を import しており、vitest では browser 条件で解決されて例外になる
vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => {
        mocks.upsert.mockReturnValue({ select: () => Promise.resolve({ error: null }) });
        mocks.from.mockReturnValue({ upsert: mocks.upsert });
        return { from: mocks.from };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

function payload(): Record<string, unknown> {
  return mocks.upsert.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('createOrUpdateWordPressSettings のトークン保持', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('トークン未指定なら token 列を payload に含めない（保存済みを消さない）', async () => {
    const service = new SupabaseService();

    await service.createOrUpdateWordPressSettings('user-1', '', '', 'site-1', {
      wpContentTypes: ['post'],
    });

    expect(payload()).not.toHaveProperty('wp_access_token');
    expect(payload()).not.toHaveProperty('wp_refresh_token');
    expect(payload()).not.toHaveProperty('wp_token_expires_at');
    // 設定側は従来どおり書き込まれる
    expect(payload()).toMatchObject({ user_id: 'user-1', wp_site_id: 'site-1' });
  });

  it('トークン指定時（OAuth コールバック）は従来どおり書き込む', async () => {
    const service = new SupabaseService();

    await service.createOrUpdateWordPressSettings('user-1', 'cid', 'secret', 'site-1', {
      accessToken: 'at',
      refreshToken: 'rt',
      tokenExpiresAt: '2026-09-05T00:00:00.000Z',
    });

    expect(payload()).toMatchObject({
      wp_access_token: 'at',
      wp_refresh_token: 'rt',
      wp_token_expires_at: '2026-09-05T00:00:00.000Z',
    });
  });
});
