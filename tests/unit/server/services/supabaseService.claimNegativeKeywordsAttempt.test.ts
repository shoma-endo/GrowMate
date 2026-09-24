import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  or: vi.fn(),
  update: vi.fn(),
  result: { data: null as { id: string } | null, error: null as unknown },
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => {
        const query = {
          update: mocks.update,
          eq: mocks.eq,
          or: mocks.or,
          select: vi.fn(),
          maybeSingle: vi.fn(() => Promise.resolve(mocks.result)),
        };
        mocks.update.mockReturnValue(query);
        mocks.eq.mockReturnValue(query);
        mocks.or.mockReturnValue(query);
        query.select.mockReturnValue(query);
        return { from: vi.fn(() => query) };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

describe('SupabaseService.claimGoogleAdsNegativeKeywordsAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result = { data: { id: 'settings-id' }, error: null };
  });

  it('user_id と当日未試行条件を付け、更新された行を確保成功として返す', async () => {
    const result = await new SupabaseService().claimGoogleAdsNegativeKeywordsAttempt(
      'user-1',
      '2026-09-24'
    );

    expect(result).toStrictEqual({ success: true, data: true });
    expect(mocks.update).toHaveBeenCalledWith({
      last_attempted_on: '2026-09-24',
      updated_at: expect.any(String),
    });
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.or).toHaveBeenCalledWith(
      'last_attempted_on.is.null,last_attempted_on.neq.2026-09-24'
    );
  });

  it('更新された行が無ければ確保失敗を返す', async () => {
    mocks.result = { data: null, error: null };

    await expect(
      new SupabaseService().claimGoogleAdsNegativeKeywordsAttempt('user-1', '2026-09-24')
    ).resolves.toStrictEqual({ success: true, data: false });
  });

  it('DB エラーを failure として返す', async () => {
    mocks.result = { data: null, error: { message: 'database unavailable' } };

    const result = await new SupabaseService().claimGoogleAdsNegativeKeywordsAttempt(
      'user-1',
      '2026-09-24'
    );

    expect(result.success).toBe(false);
  });
});
