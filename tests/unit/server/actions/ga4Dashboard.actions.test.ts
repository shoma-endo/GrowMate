import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  emailLinkConflictErrorPayload: () => null,
}));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      mocks.getClient();
      return null;
    }
  },
}));
vi.mock('@/server/services/ga4ContentEvaluationService', () => ({
  ga4ContentEvaluationService: {
    fetchLatestSuccessfulContentScores: vi.fn(),
  },
}));

import {
  fetchGa4DashboardData,
  fetchGa4DashboardRanking,
  fetchGa4DashboardTimeseries,
  fetchGa4MediaContentScores,
} from '@/server/actions/ga4Dashboard.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

describe('ga4Dashboard actions のGA4未認可応答', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({
      lineUserId: '',
      userId: USER_ID,
      userDetails: { role: 'trial' },
    });
  });

  it('全公開Actionが認可前にGA4データへ到達せず拒否する', async () => {
    const expected = {
      success: false,
      error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED,
    };

    await expect(fetchGa4DashboardRanking({})).resolves.toEqual(expected);
    await expect(fetchGa4DashboardTimeseries({})).resolves.toEqual(expected);
    await expect(fetchGa4DashboardData({})).resolves.toEqual(expected);
    await expect(fetchGa4MediaContentScores()).resolves.toEqual(expected);

    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});
