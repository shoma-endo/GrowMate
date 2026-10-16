import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  getWordPressSettingsByUserId: vi.fn(),
  createOrUpdateSelfHostedWordPressSettings: vi.fn(),
  importGscData: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));

vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  emailLinkConflictErrorPayload: () => null,
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getWordPressSettingsByUserId = mocks.getWordPressSettingsByUserId;
    createOrUpdateSelfHostedWordPressSettings = mocks.createOrUpdateSelfHostedWordPressSettings;
  },
}));

vi.mock('@/server/services/gscImportService', () => ({
  gscImportService: { importMetrics: mocks.importGscData },
}));
vi.mock('@/server/services/gscEvaluationService', () => ({ gscEvaluationService: {} }));
vi.mock('@/server/services/wordpressImportService', () => ({ importWordPressContent: vi.fn() }));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { runGscImport } from '@/server/actions/gscImport.actions';
import { runWordpressBulkImport } from '@/server/actions/wordpressImport.actions';
import {
  saveWordPressSettingsAction,
  testWordPressConnectionAction,
} from '@/server/actions/wordpress.actions';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

function signInAs(role: 'trial' | 'paid') {
  mocks.authMiddleware.mockResolvedValue({ lineUserId: '', userId: USER_ID, userDetails: { role } });
}

const SELF_HOSTED_PARAMS = {
  wpType: 'self_hosted' as const,
  wpSiteUrl: 'https://example.com',
  wpUsername: 'user',
  wpApplicationPassword: 'app-password',
};

describe('GSC・WordPress 連携の Server Action は trial を拒否する', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWordPressSettingsByUserId.mockResolvedValue(null);
  });

  it('trial は GSC 取込を拒否され、取込処理を呼ばない', async () => {
    signInAs('trial');

    const result = await runGscImport({ startDate: '2026-10-01', endDate: '2026-10-07' });

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.importGscData).not.toHaveBeenCalled();
  });

  it('trial は WordPress 一括取込を拒否され、設定を読まない', async () => {
    signInAs('trial');

    const result = await runWordpressBulkImport();

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.getWordPressSettingsByUserId).not.toHaveBeenCalled();
  });

  it('trial は WordPress 設定の保存を拒否され、保存処理を呼ばない', async () => {
    signInAs('trial');

    const result = await saveWordPressSettingsAction(SELF_HOSTED_PARAMS);

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.createOrUpdateSelfHostedWordPressSettings).not.toHaveBeenCalled();
  });

  it('trial は WordPress 接続テストを拒否され、設定を読まない', async () => {
    signInAs('trial');

    const result = await testWordPressConnectionAction();

    expect(result).toEqual({ success: false, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED });
    expect(mocks.getWordPressSettingsByUserId).not.toHaveBeenCalled();
  });

  it('paid はロール確認を通過して各処理の本体へ進む', async () => {
    signInAs('paid');

    expect(await runGscImport({ startDate: '', endDate: '' })).toEqual({
      success: false,
      error: ERROR_MESSAGES.GSC.DATE_RANGE_REQUIRED,
    });
    expect(await runWordpressBulkImport()).toEqual({
      success: false,
      error: ERROR_MESSAGES.WORDPRESS.SETTINGS_INCOMPLETE,
    });
    expect(await testWordPressConnectionAction()).toEqual({
      success: false,
      error: ERROR_MESSAGES.WORDPRESS.SETTINGS_NOT_REGISTERED,
    });
    await saveWordPressSettingsAction(SELF_HOSTED_PARAMS);
    expect(mocks.createOrUpdateSelfHostedWordPressSettings).toHaveBeenCalledOnce();
  });
});
