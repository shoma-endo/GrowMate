import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GSC・GA4 の自動取込の結果（auto-daily-imports-spec FR-011）を、どこで書きどこで NULL に戻すかを固定する。
 * NULL に戻し忘れると、プロパティを選び直したり再連携したりしても「アクセスできません」が消えない。
 */

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
        mocks.upsert.mockReturnValue({ select: () => Promise.resolve({ error: null }) });
        // update().eq() は待てる値で、さらに .eq() も続けられる（PostgREST のビルダーと同じ）
        const chain = Object.assign(Promise.resolve({ error: null }), { eq: mocks.eq });
        mocks.eq.mockReturnValue(chain);
        mocks.update.mockReturnValue(chain);
        mocks.from.mockReturnValue({ upsert: mocks.upsert, update: mocks.update });
        return { from: mocks.from };
      },
    }),
  },
}));

import { SupabaseService } from '@/server/services/supabaseService';

const statusColumns = {
  gsc_auto_import_status: null,
  gsc_auto_import_status_at: null,
  ga4_auto_import_status: null,
  ga4_auto_import_status_at: null,
};

describe('gsc_credentials の自動取込の結果', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('OAuth コールバックの upsert は GSC・GA4 とも NULL に戻す', async () => {
    await new SupabaseService().upsertGscCredential('user-1', { refreshToken: 'refresh-token' });

    expect(mocks.upsert.mock.calls[0]?.[0]).toMatchObject(statusColumns);
  });

  it('部分更新は指定した側だけを NULL に戻し、指定しなければ触らない', async () => {
    const service = new SupabaseService();

    await service.updateGscCredential('user-1', { propertyUri: 'sc-domain:example.com', gscAutoImportStatus: null });
    await service.updateGscCredential('user-1', { ga4PropertyId: 'properties/1', ga4AutoImportStatus: null });
    await service.updateGscCredential('user-1', { accessToken: 'access-token' });

    const [gscReset, ga4Reset, tokenOnly] = mocks.update.mock.calls.map(([record]) => record as Record<string, unknown>);
    expect(gscReset).toMatchObject({ gsc_auto_import_status: null, gsc_auto_import_status_at: null });
    expect(gscReset).not.toHaveProperty('ga4_auto_import_status');
    expect(ga4Reset).toMatchObject({ ga4_auto_import_status: null, ga4_auto_import_status_at: null });
    expect(ga4Reset).not.toHaveProperty('gsc_auto_import_status');
    expect(tokenOnly).not.toHaveProperty('gsc_auto_import_status');
    expect(tokenOnly).not.toHaveProperty('ga4_auto_import_status');
  });

  it('結果の記録は取込元の列だけを、取込に使ったプロパティが選ばれている行にだけ書く', async () => {
    await new SupabaseService().recordGoogleAutoImportResult('user-1', 'ga4', 'permission_denied', 'properties/1');

    const record = mocks.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(record).toMatchObject({ ga4_auto_import_status: 'permission_denied' });
    expect(typeof record.ga4_auto_import_status_at).toBe('string');
    expect(record).not.toHaveProperty('gsc_auto_import_status');
    expect(mocks.eq.mock.calls).toEqual([
      ['ga4_property_id', 'properties/1'],
      ['user_id', 'user-1'],
    ]);
  });

  it('GSC の結果は property_uri で絞る', async () => {
    await new SupabaseService().recordGoogleAutoImportResult('user-1', 'gsc', 'succeeded', 'sc-domain:example.com');

    expect(mocks.eq.mock.calls).toEqual([
      ['property_uri', 'sc-domain:example.com'],
      ['user_id', 'user-1'],
    ]);
  });
});
