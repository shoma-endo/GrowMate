import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  runNextJob: vi.fn(),
}));

vi.mock('@/server/services/contentAnnotationSummaryJobService', () => ({
  contentAnnotationSummaryJobService: {
    runNextJob: mocks.runNextJob,
  },
}));

import { GET } from '../../../../app/api/cron/content-annotation-summary/route';

const request = (authorization?: string) =>
  new NextRequest('http://localhost/api/cron/content-annotation-summary', {
    ...(authorization ? { headers: { authorization } } : {}),
  });

describe('content-annotation-summary Cron Route Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('成功時は200とcount-batch互換のroot success/dataを返す', async () => {
    const result = { failed: 0, processedJobs: 1 };
    mocks.runNextJob.mockResolvedValue(result);

    const response = await GET(request('Bearer test-cron-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: result });
  });

  it('ジョブ単位の失敗時は200だがroot successをfalseにする', async () => {
    const result = { failed: 1, processedJobs: 1 };
    mocks.runNextJob.mockResolvedValue(result);

    const response = await GET(request('Bearer test-cron-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: false, data: result });
  });

  it('Authorization が無ければ401で処理を呼ばない', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(mocks.runNextJob).not.toHaveBeenCalled();
  });

  it('CRON_SECRET が無ければ500で処理を呼ばない', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(request('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Cron secret not configured',
    });
    expect(mocks.runNextJob).not.toHaveBeenCalled();
  });

  it('処理例外時は500とエラーを返す', async () => {
    mocks.runNextJob.mockRejectedValue(new Error('batch exploded'));

    const response = await GET(request('Bearer test-cron-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'batch exploded' });
  });
});
