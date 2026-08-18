import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getEvaluationSettings: vi.fn(),
  setEvaluationEnabled: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/services/ga4ContentEvaluationService', () => ({
  ga4ContentEvaluationService: {
    getEvaluationSettings: mocks.getEvaluationSettings,
    setEvaluationEnabled: mocks.setEvaluationEnabled,
  },
}));

import {
  fetchGa4EvaluationSettings,
  setGa4EvaluationEnabled,
} from '@/server/actions/adminGa4Evaluation.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const ADMIN_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

describe('adminGa4Evaluation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: ADMIN_ID,
      userDetails: { role: 'admin' },
    });
    mocks.getEvaluationSettings.mockResolvedValue({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });
    mocks.setEvaluationEnabled.mockResolvedValue(undefined);
  });

  it.each(['paid', 'trial', 'unavailable'] as const)(
    'admin以外(%s)は読み取りも切り替えも拒否しサービスを呼ばない',
    async role => {
      mocks.authMiddleware.mockResolvedValue({
        lineUserId: '',
        userId: ADMIN_ID,
        userDetails: { role },
      });

      const read = await fetchGa4EvaluationSettings();
      const write = await setGa4EvaluationEnabled({ enabled: true });

      expect(read).toEqual({ success: false, error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS });
      expect(write).toEqual({ success: false, error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS });
      expect(mocks.getEvaluationSettings).not.toHaveBeenCalled();
      expect(mocks.setEvaluationEnabled).not.toHaveBeenCalled();
    }
  );

  it('adminは現在値を取得できる', async () => {
    mocks.getEvaluationSettings.mockResolvedValue({
      enabled: true,
      updatedAt: '2026-08-19T00:00:00.000Z',
      updatedBy: ADMIN_ID,
    });

    const result = await fetchGa4EvaluationSettings();

    expect(result).toEqual({
      success: true,
      data: { enabled: true, updatedAt: '2026-08-19T00:00:00.000Z' },
    });
  });

  it('adminの切り替えは更新者IDとともにサービスへ渡る', async () => {
    const result = await setGa4EvaluationEnabled({ enabled: true });

    expect(mocks.setEvaluationEnabled).toHaveBeenCalledWith(true, ADMIN_ID);
    expect(result).toEqual({ success: true, data: { enabled: true } });
  });

  it('enabledがbooleanでない要求は検証で弾く', async () => {
    const result = await setGa4EvaluationEnabled({
      enabled: 'true',
    } as unknown as { enabled: boolean });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED });
    expect(mocks.setEvaluationEnabled).not.toHaveBeenCalled();
  });

  it('サービスが失敗しても例外を漏らさずエラーを返す', async () => {
    mocks.setEvaluationEnabled.mockRejectedValue(new Error('db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await setGa4EvaluationEnabled({ enabled: false });

    expect(result).toEqual({
      success: false,
      error: ERROR_MESSAGES.GA4.EVALUATION_SETTINGS_SAVE_FAILED,
    });
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
