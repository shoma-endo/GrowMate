import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => {
        const query = {
          update: mocks.update,
          eq: mocks.eq,
          then: (resolve: (value: { error: null }) => unknown) =>
            resolve({ error: null }),
        };
        mocks.update.mockReturnValue(query);
        mocks.eq.mockReturnValue(query);
        mocks.from.mockReturnValue({
          upsert: mocks.upsert,
          update: mocks.update,
        });
        mocks.upsert.mockResolvedValue({ error: null });
        return { from: mocks.from };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

describe('SupabaseService Instagram credential followers fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('連携時はフォロワー数と取得時刻を同じ upsert に含める', async () => {
    await new SupabaseService().saveInstagramCredential('user-1', {
      igUserId: 'ig-1',
      accessToken: 'token',
      accessTokenExpiresAt: '2026-10-01T00:00:00.000Z',
      accessTokenIssuedAt: '2026-09-21T00:00:00.000Z',
      followers: { count: 3200, syncedAt: '2026-09-21T00:00:00.000Z' },
    });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        followers_count: 3200,
        followers_count_synced_at: '2026-09-21T00:00:00.000Z',
      }),
      { onConflict: 'user_id' }
    );
  });

  it('アカウント切り替え時は2列を同時に null にする', async () => {
    await new SupabaseService().updateInstagramCredential('user-1', { followers: null });

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        followers_count: null,
        followers_count_synced_at: null,
      })
    );
  });
});
