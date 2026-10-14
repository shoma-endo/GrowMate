import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  gsc: { runDailyBatch: vi.fn() },
  ga4: { runBatch: vi.fn() },
  wordpress: { runDailyBatch: vi.fn() },
}));

vi.mock('@/server/services/gscImportService', () => ({ gscImportService: mocks.gsc }));
vi.mock('@/server/services/ga4ImportService', () => ({ ga4ImportService: mocks.ga4 }));
vi.mock('@/server/services/wordpressImportService', () => ({ wordpressImportService: mocks.wordpress }));
vi.mock('@/server/lib/cron-definitions', () => ({
  CRON_DEFINITIONS: {
    gscDailyImport: { logRouteFailure: vi.fn() },
    ga4DailySync: { logRouteFailure: vi.fn() },
    wordpressDailyImport: { logRouteFailure: vi.fn() },
  },
}));

import { GET as getGsc } from '../../../../app/api/cron/gsc-daily-import/route';
import { GET as getGa4 } from '../../../../app/api/cron/ga4-daily-sync/route';
import { GET as getWordPress } from '../../../../app/api/cron/wordpress-daily-import/route';

describe.each([
  ['/api/cron/gsc-daily-import', getGsc, mocks.gsc.runDailyBatch],
  ['/api/cron/ga4-daily-sync', getGa4, mocks.ga4.runBatch],
  ['/api/cron/wordpress-daily-import', getWordPress, mocks.wordpress.runDailyBatch],
])('%s の認証（auto-daily-imports-spec §6）', (path, get, runBatch) => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it.each([['ヘッダーなし', undefined], ['違う値', 'Bearer wrong']])('%sなら401でサービスを呼ばない', async (_label, authorization) => {
    const request = new NextRequest(`http://localhost${path}`, authorization
      ? { headers: { authorization } }
      : undefined);
    const response = await get(request);

    expect(response.status).toBe(401);
    expect(runBatch).not.toHaveBeenCalled();
  });
});
