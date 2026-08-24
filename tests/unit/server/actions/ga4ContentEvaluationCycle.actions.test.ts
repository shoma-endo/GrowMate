import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  fetchCycle: vi.fn(),
  registerCycle: vi.fn(),
  updateCycle: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/services/ga4ContentEvaluationCycleService', () => ({
  ga4ContentEvaluationCycleService: {
    fetchCycle: mocks.fetchCycle,
    registerCycle: mocks.registerCycle,
    updateCycle: mocks.updateCycle,
  },
}));

import {
  fetchGa4ContentEvaluationCycle,
  registerGa4ContentEvaluationCycle,
  updateGa4ContentEvaluationCycle,
} from '@/server/actions/ga4ContentEvaluationCycle.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';
const ANNOTATION_ID = '2d6f9c6e-6a3d-4d6b-8a4f-2b4c3e1d0f99';
const VALID_INPUT = {
  annotationId: ANNOTATION_ID,
  baseEvaluationDate: '2026-08-24',
  cycleDays: 30,
  evaluationHour: 12,
};

describe('ga4ContentEvaluationCycle actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'paid' },
    });
    mocks.fetchCycle.mockResolvedValue(null);
    mocks.registerCycle.mockResolvedValue({ id: 'cycle-1' });
    mocks.updateCycle.mockResolvedValue({ id: 'cycle-1' });
  });

  it('未認可（trial）はサービスを呼ばず拒否する', async () => {
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'trial' },
    });

    await expect(fetchGa4ContentEvaluationCycle(ANNOTATION_ID)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    await expect(registerGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    await expect(updateGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    });
    expect(mocks.fetchCycle).not.toHaveBeenCalled();
    expect(mocks.registerCycle).not.toHaveBeenCalled();
    expect(mocks.updateCycle).not.toHaveBeenCalled();
  });

  it('入口で入力を検証し、不正入力をサービスへ渡さない', async () => {
    await expect(fetchGa4ContentEvaluationCycle('not-an-uuid')).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    await expect(registerGa4ContentEvaluationCycle({ ...VALID_INPUT, cycleDays: 0 })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    await expect(registerGa4ContentEvaluationCycle({ ...VALID_INPUT, cycleDays: 366 })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    await expect(registerGa4ContentEvaluationCycle({ ...VALID_INPUT, evaluationHour: 24 })).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED,
    });
    expect(mocks.fetchCycle).not.toHaveBeenCalled();
    expect(mocks.registerCycle).not.toHaveBeenCalled();
  });

  it('認可済みの入力だけサービスへユーザーID付きで渡す', async () => {
    await expect(fetchGa4ContentEvaluationCycle(ANNOTATION_ID)).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(mocks.fetchCycle).toHaveBeenCalledWith(USER_ID, ANNOTATION_ID);

    await expect(registerGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: true,
      data: { id: 'cycle-1' },
    });
    expect(mocks.registerCycle).toHaveBeenCalledWith(USER_ID, VALID_INPUT);

    await expect(updateGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: true,
      data: { id: 'cycle-1' },
    });
    expect(mocks.updateCycle).toHaveBeenCalledWith(USER_ID, VALID_INPUT);
  });

  it('重複登録・記事未検出・未登録更新のエラーコードを利用者向け文言へ分類する', async () => {
    mocks.registerCycle.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'article_not_found' }));
    await expect(registerGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.CYCLE_ARTICLE_NOT_FOUND,
    });

    mocks.registerCycle.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'cycle_already_registered' })
    );
    await expect(registerGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.CYCLE_ALREADY_REGISTERED,
    });

    mocks.updateCycle.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'cycle_not_found' }));
    await expect(updateGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.CYCLE_NOT_FOUND,
    });
  });

  it('未分類のサービスエラーは既定の失敗文言を返す', async () => {
    mocks.registerCycle.mockRejectedValueOnce(new Error('unexpected'));
    await expect(registerGa4ContentEvaluationCycle(VALID_INPUT)).resolves.toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.CYCLE_REGISTER_FAILED,
    });
  });
});
