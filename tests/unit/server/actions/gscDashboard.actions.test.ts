import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  emailLinkConflictErrorPayload: () => null,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return null;
    }
  },
}));

vi.mock('@/server/services/gscImportService', () => ({
  gscImportService: {},
}));

import {
  fetchGscDetail,
  fetchQueryAnalysis,
  registerEvaluation,
  runEvaluationNow,
  runQueryImportForAnnotation,
  updateEvaluation,
} from '@/server/actions/gscDashboard.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

type UnauthorizedResult = {
  success: boolean;
  error?: string;
  data?: unknown;
};

function expectUnauthorized(result: UnauthorizedResult) {
  expect(result).toEqual({
    success: false,
    error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
  });
  expect('data' in result).toBe(false);
}

describe('gscDashboard actions のGA4未認可応答', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'trial' },
    });
  });

  it('読み取り2本と書き込み4本がデータなしの拒否ペイロードを返す', async () => {
    expectUnauthorized(await fetchGscDetail('annotation-id'));
    expectUnauthorized(await fetchQueryAnalysis('annotation-id'));
    expectUnauthorized(
      await registerEvaluation({
        contentAnnotationId: 'annotation-id',
        propertyUri: 'https://www.google.com/webmasters/tools',
        baseEvaluationDate: '2026-08-01',
      })
    );
    expectUnauthorized(
      await updateEvaluation({
        contentAnnotationId: 'annotation-id',
        baseEvaluationDate: '2026-08-01',
      })
    );
    expectUnauthorized(await runQueryImportForAnnotation('annotation-id'));
    expectUnauthorized(await runEvaluationNow('annotation-id'));
  });
});
