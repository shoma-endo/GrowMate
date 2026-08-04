import { beforeEach, describe, expect, it, vi } from 'vitest';

type DueRow = {
  id: string;
  user_id: string;
  enabled: boolean;
  send_hour_jst: number;
  last_sent_on: string | null;
  last_attempted_on: string | null;
  last_send_error: string | null;
  created_at: string;
  updated_at: string;
};

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  result: { data: [] as DueRow[], error: null as unknown },
}));

// supabaseService は 'server-only' を import しており、vitest では browser 条件で解決されて例外になる
vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => {
        const query = {
          select: mocks.select,
          eq: mocks.eq,
          lte: mocks.lte,
          order: mocks.order,
          // 最終的な await でクエリ結果を返す
          then: (resolve: (value: unknown) => unknown) => resolve(mocks.result),
        };
        mocks.select.mockReturnValue(query);
        mocks.eq.mockReturnValue(query);
        mocks.lte.mockReturnValue(query);
        mocks.order.mockReturnValue(query);
        mocks.from.mockReturnValue(query);
        return { from: mocks.from };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

const row = (overrides: Partial<DueRow>): DueRow => ({
  id: 'settings-id',
  user_id: 'user-id',
  enabled: true,
  send_hour_jst: 7,
  last_sent_on: null,
  last_attempted_on: null,
  last_send_error: null,
  created_at: '2026-08-03T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
  ...overrides,
});

describe('SupabaseService.listDueGoogleAdsNegativeKeywordsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result = { data: [], error: null };
  });

  it('送信時刻を過ぎたユーザーも対象にする（取りこぼしを同日中に回収するため）', async () => {
    await new SupabaseService().listDueGoogleAdsNegativeKeywordsSettings(9, '2026-08-03');

    expect(mocks.eq).toHaveBeenCalledWith('enabled', true);
    expect(mocks.lte).toHaveBeenCalledWith('send_hour_jst', 9);
    // 打ち切り時に同じユーザーが切り捨てられ続けないよう決定的に並べる
    expect(mocks.order).toHaveBeenCalledWith('send_hour_jst', { ascending: true });
    expect(mocks.order).toHaveBeenCalledWith('user_id', { ascending: true });
  });

  it('当日送信済み・当日試行済みを除外し、未着手のみ返す', async () => {
    mocks.result = {
      data: [
        row({ user_id: 'sent-today', last_sent_on: '2026-08-03' }),
        row({ user_id: 'attempted-today', last_attempted_on: '2026-08-03' }),
        row({ user_id: 'attempted-yesterday', last_attempted_on: '2026-08-02' }),
        row({ user_id: 'never-attempted' }),
      ],
      error: null,
    };

    const result = await new SupabaseService().listDueGoogleAdsNegativeKeywordsSettings(
      9,
      '2026-08-03'
    );

    expect(result.success).toBe(true);
    expect(result.success && result.data.map(setting => setting.userId)).toStrictEqual([
      'attempted-yesterday',
      'never-attempted',
    ]);
  });
});
