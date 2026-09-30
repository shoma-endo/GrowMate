import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  authMiddleware: vi.fn(),
  start: vi.fn(),
  runBatch: vi.fn(),
}));

vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/server/middleware/auth.middleware', () => ({ authMiddleware: mocks.authMiddleware }));

vi.mock('@/server/services/instagramBlogDraftJobService', () => ({
  instagramBlogDraftJobService: {
    start: mocks.start,
    runBatch: mocks.runBatch,
  },
  InstagramBlogDraftBatchActiveError: class InstagramBlogDraftBatchActiveError extends Error {},
}));

import { POST } from '../../../../app/api/instagram/blog-drafts/route';
import { InstagramBlogDraftBatchActiveError } from '@/server/services/instagramBlogDraftJobService';

describe('POST /api/instagram/blog-drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ error: null, userId: 'user-1', userDetails: { role: 'paid' } });
    mocks.start.mockResolvedValue({
      batchId: '00000000-0000-4000-8000-000000000002',
      started: 1,
      resumed: 0,
      excluded: { created: 0, emptyCaption: 0, unavailable: 0 },
    });
  });

  it.each([
    [{ error: 'Unauthenticated', userId: null, userDetails: null }, 401],
    [{ error: null, userId: 'user-1', userDetails: { role: 'trial' } }, 403],
  ] as const)('認証結果 %j は %i で拒否する', async (authResult, expectedStatus) => {
    mocks.authMiddleware.mockResolvedValue(authResult);
    const response = await POST(new Request('https://growmate.test/api/instagram/blog-drafts', {
      method: 'POST',
      body: JSON.stringify({ instagramMediaIds: ['00000000-0000-4000-8000-000000000001'] }),
    }));

    expect(response.status).toBe(expectedStatus);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('許可ロールは起票し、response 後に値渡しでワーカーを起動する', async () => {
    const response = await POST(new Request('https://growmate.test/api/instagram/blog-drafts', {
      method: 'POST',
      body: JSON.stringify({ instagramMediaIds: ['00000000-0000-4000-8000-000000000001'] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      started: 1,
      resumed: 0,
      excluded: { created: 0, emptyCaption: 0, unavailable: 0 },
    });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith('user-1', ['00000000-0000-4000-8000-000000000001']);
    await mocks.after.mock.calls[0]?.[0]();
    expect(mocks.runBatch).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002', 'user-1', 'paid');
  });

  it('選んだ投稿がすべて対象外なら 400 と対象外の内訳を返し、ワーカーを動かさない', async () => {
    mocks.start.mockResolvedValue({
      batchId: null,
      started: 0,
      resumed: 0,
      excluded: { created: 1, emptyCaption: 1, unavailable: 0 },
    });

    const response = await POST(new Request('https://growmate.test/api/instagram/blog-drafts', {
      method: 'POST',
      body: JSON.stringify({ instagramMediaIds: ['00000000-0000-4000-8000-000000000001'] }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      started: 0,
      resumed: 0,
      excluded: { created: 1, emptyCaption: 1, unavailable: 0 },
    });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('11件以上は起票せず 400', async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `00000000-0000-4000-8000-0000000000${String(index + 10)}`);
    const response = await POST(new Request('https://growmate.test/api/instagram/blog-drafts', {
      method: 'POST',
      body: JSON.stringify({ instagramMediaIds: ids }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('作成中のまとまりがあって開始が拒否されたら 409 を返し、ワーカーを動かさない', async () => {
    mocks.start.mockRejectedValue(new InstagramBlogDraftBatchActiveError());
    const response = await POST(new Request('https://growmate.test/api/instagram/blog-drafts', {
      method: 'POST',
      body: JSON.stringify({ instagramMediaIds: ['00000000-0000-4000-8000-000000000001'] }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
