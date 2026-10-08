import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  authorizeContinuation: vi.fn(),
  runBatch: vi.fn(),
}));

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/server/services/instagramBlogDraftJobService', () => ({
  instagramBlogDraftJobService: {
    authorizeContinuation: mocks.authorizeContinuation,
    runBatch: mocks.runBatch,
  },
}));

import { POST } from '../../../../app/api/instagram/blog-drafts/continue/route';

const BATCH_ID = '00000000-0000-4000-8000-000000000002';

function request(authorization: string | null, body: unknown = { batchId: BATCH_ID }): Request {
  return new Request('https://growmate.test/api/instagram/blog-drafts/continue', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body),
  });
}

describe('POST /api/instagram/blog-drafts/continue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'secret');
    mocks.authorizeContinuation.mockResolvedValue({ userId: 'user-1', userRole: 'paid' });
  });

  it.each([null, 'Bearer wrong'])('Authorization %s は 401 で拒否し、ワーカーを動かさない', async authorization => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    expect(mocks.authorizeContinuation).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('CRON_SECRET が未設定なら 500 で拒否する', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await POST(request('Bearer '));

    expect(response.status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('batchId が UUID でなければ 400', async () => {
    const response = await POST(request('Bearer secret', { batchId: 'not-uuid' }));

    expect(response.status).toBe(400);
    expect(mocks.authorizeContinuation).not.toHaveBeenCalled();
  });

  it('権限を読み直して、所有者とロールでワーカーを応答後に動かす', async () => {
    const response = await POST(request('Bearer secret'));

    expect(response.status).toBe(200);
    expect(mocks.authorizeContinuation).toHaveBeenCalledWith(BATCH_ID);
    await mocks.after.mock.calls[0]?.[0]();
    expect(mocks.runBatch).toHaveBeenCalledWith(BATCH_ID, 'user-1', 'paid');
  });

  it('権限が外れていればワーカーを動かさない', async () => {
    mocks.authorizeContinuation.mockResolvedValue(null);

    const response = await POST(request('Bearer secret'));

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
