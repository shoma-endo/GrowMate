import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  resolveAllAnnotationIds: vi.fn(),
  resolveGscPropertyUri: vi.fn(),
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
    resolveGscPropertyUri(...args: unknown[]) {
      return mocks.resolveGscPropertyUri(...args);
    }
  },
}));

vi.mock('@/server/services/gscImportService', () => ({
  gscImportService: {},
}));

vi.mock('@/server/services/analyticsContentService', () => ({
  analyticsContentService: {
    resolveAllAnnotationIds: mocks.resolveAllAnnotationIds,
  },
}));

import {
  fetchGscDetail,
  fetchQueryAnalysis,
  registerEvaluation,
  registerEvaluationsBulk,
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

  it('trial は一括開始を拒否し、dataを返さない', async () => {
    const result = await registerEvaluationsBulk({
      mode: 'ids',
      contentAnnotationIds: ['00000000-0000-4000-8000-000000000001'],
    });

    expectUnauthorized(result);
  });

  it('admin の空のID配列は対象必須エラーを返す', async () => {
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'admin' },
    });

    const result = await registerEvaluationsBulk({
      mode: 'ids',
      contentAnnotationIds: [],
    });

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.GSC.BULK_TARGETS_REQUIRED,
    });
  });

  it('admin の1001件入力は上限エラーを返す', async () => {
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'admin' },
    });
    const contentAnnotationIds = Array.from(
      { length: 1001 },
      (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    );

    const result = await registerEvaluationsBulk({ mode: 'ids', contentAnnotationIds });

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.GSC.BULK_TARGETS_LIMIT_EXCEEDED,
    });
  });

  it('全選択の母集団が1000件超なら先頭1000件へ丸めて実行する（AC-11。エラーにしない）', async () => {
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    const ids = Array.from(
      { length: 1000 },
      (_, i) => `0000${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`
    );
    // total は limit 適用前の件数。ids は丸めた後の1000件
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids, total: 1500 });
    // 母集団の解決は GSC 連携の解決より後にあるので、ここを通す必要がある
    mocks.resolveGscPropertyUri.mockResolvedValue({ success: true, data: 'sc-domain:example.com' });

    const result = await registerEvaluationsBulk({ mode: 'all' });

    // 突合を min(total, 1000) ではなく total と比べていると、ここで
    // BULK_POPULATION_MISMATCH になり「1000件超の利用者は全選択を一度も実行できない」
    expect(result.error).not.toBe(ERROR_MESSAGES.GSC.BULK_POPULATION_MISMATCH);
    expect(mocks.resolveAllAnnotationIds).toHaveBeenCalledWith(USER_ID, 1000);
  });

  it('丸めた後の件数が上限とずれていたら1件も登録しない（R-002）', async () => {
    mocks.authMiddleware.mockResolvedValue({ userId: USER_ID, userDetails: { role: 'paid' } });
    const ids = Array.from(
      { length: 999 },
      (_, i) => `0000${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`
    );
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids, total: 1500 });
    mocks.resolveGscPropertyUri.mockResolvedValue({ success: true, data: 'sc-domain:example.com' });

    const result = await registerEvaluationsBulk({ mode: 'all' });

    expect(result.error).toBe(ERROR_MESSAGES.GSC.BULK_POPULATION_MISMATCH);
  });
});
