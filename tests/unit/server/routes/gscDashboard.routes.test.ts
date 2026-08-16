import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  nextJson409IfEmailLinkConflict: () => null,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {},
}));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GET as getDashboard } from '../../../../app/api/gsc/dashboard/route';
import { GET as getDashboardDetail } from '../../../../app/api/gsc/dashboard/[annotationId]/route';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(403);
  const body = (await response.json()) as {
    success: boolean;
    error: string;
    data?: unknown;
  };
  expect(body).toEqual({
    success: false,
    error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
  });
  expect('data' in body).toBe(false);
}

describe('gsc dashboard Route Handler のGA4未認可応答', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'trial' },
    });
  });

  it('一覧Route Handlerが403とデータなしの拒否ペイロードを返す', async () => {
    await expectUnauthorized(
      await getDashboard(new NextRequest('http://localhost/api/gsc/dashboard'))
    );
  });

  it('詳細Route Handlerが403とデータなしの拒否ペイロードを返す', async () => {
    await expectUnauthorized(
      await getDashboardDetail(
        new NextRequest('http://localhost/api/gsc/dashboard/annotation-id'),
        {
          params: Promise.resolve({ annotationId: 'annotation-id' }),
        }
      )
    );
  });
});
