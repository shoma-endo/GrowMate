import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GA4_SCOPE } from '@/lib/constants';
import { GooglePropertyAccessDeniedError } from '@/domain/errors/GooglePropertyAccessDeniedError';

const mocks = vi.hoisted(() => ({
  getCredential: vi.fn(),
  listTargets: vi.fn(),
  recordResult: vi.fn(),
  updateCredential: vi.fn(),
  runReport: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getGscCredentialByUserId = mocks.getCredential;
    listGa4SyncTargets = mocks.listTargets;
    recordGoogleAutoImportResult = mocks.recordResult;
    updateGscCredential = mocks.updateCredential;
  },
}));
vi.mock('@/server/services/gscService', () => ({ GscService: class {} }));
vi.mock('@/server/services/ga4Service', () => ({
  Ga4Service: class {
    runReport = mocks.runReport;
  },
}));

import { ga4ImportService } from '@/server/services/ga4ImportService';

describe('GA4 日次同期の結果の保存（auto-daily-imports-spec FR-011）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'));
    mocks.listTargets.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
    mocks.getCredential.mockImplementation(async (userId: string) => ({
      userId,
      refreshToken: 'refresh-token',
      accessToken: 'access-token',
      accessTokenExpiresAt: '2026-10-14T01:00:00.000Z',
      scope: [GA4_SCOPE],
      ga4PropertyId: `properties/${userId}`,
      ga4LastSyncedAt: '2026-10-10T00:00:00Z',
    }));
    mocks.recordResult.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('403 は権限切れとして保存し、ほかのユーザーの成功は成功として保存する', async () => {
    mocks.runReport.mockImplementation(async (_token: string, propertyId: string) => {
      if (propertyId === 'properties/user-1') {
        throw new GooglePropertyAccessDeniedError('GA4レポート取得に失敗しました: 403 PERMISSION_DENIED');
      }
      return { rows: [] };
    });

    const result = await ga4ImportService.runBatch();

    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(mocks.recordResult.mock.calls).toEqual(
      expect.arrayContaining([
        ['user-1', 'ga4', 'permission_denied'],
        ['user-2', 'ga4', 'succeeded'],
      ])
    );
    expect(mocks.recordResult).toHaveBeenCalledTimes(2);
  });

  it('403 以外の失敗では結果を書き換えない', async () => {
    mocks.listTargets.mockResolvedValue([{ userId: 'user-1' }]);
    mocks.runReport.mockRejectedValue(new Error('GA4レポート取得に失敗しました: 503 unavailable'));

    const result = await ga4ImportService.runBatch();

    expect(result).toMatchObject({ total: 1, failed: 1 });
    expect(mocks.recordResult).not.toHaveBeenCalled();
  });
});
