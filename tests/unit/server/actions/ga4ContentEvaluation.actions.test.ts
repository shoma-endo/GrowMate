import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  fetchEvaluation: vi.fn(),
  run: vi.fn(),
  retryNarrative: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/services/ga4ContentEvaluationService', () => ({
  ga4ContentEvaluationService: {
    fetchEvaluation: mocks.fetchEvaluation,
    run: mocks.run,
    retryNarrative: mocks.retryNarrative,
  },
}));

import {
  fetchGa4ContentEvaluation,
  runGa4ContentEvaluation,
  retryGa4ContentEvaluationNarrative,
} from '@/server/actions/ga4ContentEvaluation.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';
const ANNOTATION_ID = '2d6f9c6e-6a3d-4d6b-8a4f-2b4c3e1d0f99';

describe('ga4ContentEvaluation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'paid' },
    });
    mocks.fetchEvaluation.mockResolvedValue({});
    mocks.run.mockResolvedValue({});
    mocks.retryNarrative.mockResolvedValue({});
  });

  it('未認可の読み取り・書き込みはサービスを呼ばず拒否する', async () => {
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'trial' },
    });

    await expect(fetchGa4ContentEvaluation(ANNOTATION_ID)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    await expect(runGa4ContentEvaluation({
      annotationId: ANNOTATION_ID,
      startDate: '2026-08-01',
      endDate: '2026-08-30',
    })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    await expect(retryGa4ContentEvaluationNarrative(ANNOTATION_ID)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    expect(mocks.fetchEvaluation).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.retryNarrative).not.toHaveBeenCalled();
  });

  it('入口で記事IDと期間を検証し、不正入力をサービスへ渡さない', async () => {
    await expect(fetchGa4ContentEvaluation('not-an-uuid')).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    await expect(runGa4ContentEvaluation({
      annotationId: ANNOTATION_ID,
      startDate: '2026-08-01',
      endDate: '2026-10-31',
    })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    expect(mocks.fetchEvaluation).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.retryNarrative).not.toHaveBeenCalled();
  });

  it('認可済みの入力だけサービスへユーザーID付きで渡す', async () => {
    await expect(fetchGa4ContentEvaluation(ANNOTATION_ID)).resolves.toEqual({
      success: true,
      data: {},
    });
    await expect(runGa4ContentEvaluation({
      annotationId: ANNOTATION_ID,
      startDate: '2026-08-01',
      endDate: '2026-08-30',
    })).resolves.toEqual({
      success: true,
      data: {},
    });
    expect(mocks.fetchEvaluation).toHaveBeenCalledWith(USER_ID, ANNOTATION_ID);
    expect(mocks.run).toHaveBeenCalledWith({
      userId: USER_ID,
      annotationId: ANNOTATION_ID,
      startDate: '2026-08-01',
      endDate: '2026-08-30',
    });
    await expect(retryGa4ContentEvaluationNarrative(ANNOTATION_ID)).resolves.toEqual({
      success: true,
      data: {},
    });
    expect(mocks.retryNarrative).toHaveBeenCalledWith(USER_ID, ANNOTATION_ID);
  });

  it('サービスが例外を投げた場合は評価失敗の汎用文言を返す', async () => {
    mocks.run.mockRejectedValue(new Error('unexpected'));

    await expect(runGa4ContentEvaluation({
      annotationId: ANNOTATION_ID,
      startDate: '2026-08-01',
      endDate: '2026-08-30',
    })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED,
    });
  });
});
