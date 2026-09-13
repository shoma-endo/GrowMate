import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Service Role 経路なので RLS が効かない。**クエリが必ず `user_id` でスコープされること**が
 * 他人の設定を読み書きしない唯一の担保になる（`.agents/skills/supabase/service-usage.md` §3）。
 * ここが外れても正常系は動いてしまうため、テストで固定する。
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
}));

// supabaseService は 'server-only' を import しており、vitest では browser 条件で解決されて例外になる
vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => ({ from: mocks.from }),
    }),
  },
}));

import { userTableFieldConfigService } from '@/server/services/userTableFieldConfigService';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

function mockSelect(result: { data: unknown; error: unknown }) {
  mocks.eq.mockResolvedValue(result);
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ select: mocks.select, upsert: mocks.upsert });
}

describe('userTableFieldConfigService.getByUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('table_key ごとに構成を返し、user_id でスコープする', async () => {
    mockSelect({
      data: [
        { table_key: 'analytics', visible_ids: ['main_kw'], ordered_ids: ['main_kw', 'kw'] },
        { table_key: 'instagram_media', visible_ids: [], ordered_ids: ['reach'] },
      ],
      error: null,
    });

    const result = await userTableFieldConfigService.getByUser(USER_ID);

    expect(mocks.from).toHaveBeenCalledWith('user_table_field_configs');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({
      analytics: { visibleIds: ['main_kw'], orderedIds: ['main_kw', 'kw'] },
      // 空配列（全解除）を落とさない
      instagram_media: { visibleIds: [], orderedIds: ['reach'] },
    });
  });

  it('未保存なら空オブジェクト（呼び出し側が既定へ畳む）', async () => {
    mockSelect({ data: [], error: null });
    await expect(userTableFieldConfigService.getByUser(USER_ID)).resolves.toEqual({});
  });

  it('取得失敗でも例外にせず空を返す（一覧全体を落とさない）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSelect({ data: null, error: { message: 'boom' } });
    await expect(userTableFieldConfigService.getByUser(USER_ID)).resolves.toEqual({});
  });
});

describe('userTableFieldConfigService.upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('user_id と table_key の組で upsert する', async () => {
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ select: mocks.select, upsert: mocks.upsert });

    const ok = await userTableFieldConfigService.upsert({
      userId: USER_ID,
      tableKey: 'analytics',
      visibleIds: ['main_kw'],
      orderedIds: ['main_kw', 'kw'],
    });

    expect(ok).toBe(true);
    expect(mocks.upsert.mock.calls[0]?.[0]).toMatchObject({
      user_id: USER_ID,
      table_key: 'analytics',
      visible_ids: ['main_kw'],
      ordered_ids: ['main_kw', 'kw'],
    });
    expect(mocks.upsert.mock.calls[0]?.[1]).toEqual({ onConflict: 'user_id,table_key' });
  });

  it('保存失敗は false を返す（呼び出し側がユーザーへ通知する）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.upsert.mockResolvedValue({ error: { message: 'boom' } });
    mocks.from.mockReturnValue({ select: mocks.select, upsert: mocks.upsert });

    await expect(
      userTableFieldConfigService.upsert({
        userId: USER_ID,
        tableKey: 'analytics',
        visibleIds: [],
        orderedIds: [],
      })
    ).resolves.toBe(false);
  });
});
