import { beforeEach, describe, expect, it, vi } from 'vitest';

type ClaimResult = { data: { id: string } | null; error: unknown };

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  is: vi.fn(),
  neq: vi.fn(),
  or: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  results: [] as ClaimResult[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/client-manager', () => ({
  SupabaseClientManager: {
    getInstance: () => ({
      getServiceRoleClient: () => {
        const query = {
          update: mocks.update,
          eq: mocks.eq,
          is: mocks.is,
          neq: mocks.neq,
          or: mocks.or,
          select: mocks.select,
          maybeSingle: vi.fn(() => Promise.resolve(mocks.results.shift())),
        };
        for (const method of [mocks.update, mocks.eq, mocks.is, mocks.neq, mocks.or, mocks.select]) {
          method.mockReturnValue(query);
        }
        return { from: vi.fn(() => query) };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

const claim = () =>
  new SupabaseService().claimGoogleAdsNegativeKeywordsAttempt('user-1', '2026-09-24');

describe('SupabaseService.claimGoogleAdsNegativeKeywordsAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results = [];
  });

  it('未試行（NULL）の行を確保できたら、2回目の更新をせず確保成功を返す', async () => {
    mocks.results = [{ data: { id: 'settings-id' }, error: null }];

    await expect(claim()).resolves.toStrictEqual({ success: true, data: true });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      last_attempted_on: '2026-09-24',
      updated_at: expect.any(String),
    });
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(mocks.is).toHaveBeenCalledWith('last_attempted_on', null);
    expect(mocks.neq).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledWith('id');
  });

  it('NULL でなければ前日以前の試行を条件に確保する', async () => {
    mocks.results = [
      { data: null, error: null },
      { data: { id: 'settings-id' }, error: null },
    ];

    await expect(claim()).resolves.toStrictEqual({ success: true, data: true });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
    // 2回目に NULL 条件が混ざると「前日以前に試行」の行を二度と確保できなくなる
    expect(mocks.is).toHaveBeenCalledOnce();
    expect(mocks.neq).toHaveBeenCalledOnce();
    expect(mocks.neq).toHaveBeenCalledWith('last_attempted_on', '2026-09-24');
    expect(mocks.select).toHaveBeenNthCalledWith(2, 'id');
  });

  // PostgREST は .or() を返却行の読み出しにも再適用し、select('id') と組み合わせると 42703 になる（本番障害 2026-09-29）
  it('論理条件（.or）を使わない', async () => {
    mocks.results = [
      { data: null, error: null },
      { data: null, error: null },
    ];

    await claim();

    expect(mocks.or).not.toHaveBeenCalled();
  });

  it('どちらの条件でも更新された行が無ければ確保失敗を返す', async () => {
    mocks.results = [
      { data: null, error: null },
      { data: null, error: null },
    ];

    await expect(claim()).resolves.toStrictEqual({ success: true, data: false });
  });

  it.each([
    ['未試行の確保', [{ data: null, error: { message: 'database unavailable' } }], 1],
    [
      '前日以前の確保',
      [
        { data: null, error: null },
        { data: null, error: { message: 'database unavailable' } },
      ],
      2,
    ],
  ])('%sで DB エラーなら以降の更新をせず failure を返す', async (_label, results, updateCalls) => {
    mocks.results = results;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await claim();

    expect(result.success).toBe(false);
    expect(mocks.update).toHaveBeenCalledTimes(updateCalls);
  });
});
