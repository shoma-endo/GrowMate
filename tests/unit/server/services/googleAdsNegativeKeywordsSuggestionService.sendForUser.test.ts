import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getCredential: vi.fn(),
  getSearchTermMetrics: vi.fn(),
  getNegativeKeywords: vi.fn(),
  getCustomerInfo: vi.fn(),
  refreshAccessToken: vi.fn(),
  getTemplateByName: vi.fn(),
  getVariablesByUserId: vi.fn(),
  llmChat: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getUserById = mocks.getUserById;
    getGoogleAdsNegativeKeywordsSettings = mocks.getSettings;
    updateGoogleAdsNegativeKeywordsSettings = mocks.updateSettings;
    getGoogleAdsCredential = mocks.getCredential;
  },
}));

vi.mock('@/server/services/googleAdsService', () => ({
  GoogleAdsService: class {
    getSearchTermMetrics = mocks.getSearchTermMetrics;
    getNegativeKeywords = mocks.getNegativeKeywords;
    getCustomerInfo = mocks.getCustomerInfo;
    refreshAccessToken = mocks.refreshAccessToken;
  },
}));

vi.mock('@/server/services/emailService', () => ({
  EmailService: class {},
  emailService: { sendGoogleAdsNegativeKeywords: mocks.sendEmail },
}));

vi.mock('@/server/services/llmService', () => ({ llmChat: mocks.llmChat }));

vi.mock('@/server/services/briefService', () => ({
  briefService: { getVariablesByUserId: mocks.getVariablesByUserId },
}));

vi.mock('@/server/services/promptService', () => ({
  PromptService: { getTemplateByName: mocks.getTemplateByName },
}));

import { googleAdsNegativeKeywordsSuggestionService } from '@/server/services/googleAdsNegativeKeywordsSuggestionService';

const USER_ID = 'user-1';

describe('googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mocks.getUserById.mockResolvedValue({ success: true, data: { email: 'user@example.com' } });
    mocks.getSettings.mockResolvedValue({
      success: true,
      data: {
        userId: USER_ID,
        enabled: true,
        sendHourJst: 7,
        lastSentOn: null,
        lastAttemptedOn: null,
        lastSendError: null,
      },
    });
    mocks.updateSettings.mockResolvedValue({ success: true, data: undefined });
    mocks.getCredential.mockResolvedValue({
      customerId: '1234567890',
      managerCustomerId: null,
      accessToken: 'access-token',
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refreshToken: 'refresh-token',
      scope: [],
      googleAccountEmail: 'ads@example.com',
    });
    mocks.getSearchTermMetrics.mockResolvedValue({
      success: true,
      data: [
        {
          searchTerm: '家具 買取',
          campaignId: '1',
          campaignName: 'c',
          adGroupId: '2',
          adGroupName: 'g',
          impressions: 100,
          clicks: 3,
          cost: 500,
          conversions: 0,
          conversionValue: 0,
        },
      ],
    });
    mocks.getNegativeKeywords.mockResolvedValue({ success: true, data: [] });
    mocks.getCustomerInfo.mockResolvedValue({ name: 'テスト株式会社' });
    mocks.getVariablesByUserId.mockResolvedValue({ persona: 'ペルソナ' });
    mocks.getTemplateByName.mockResolvedValue({ content: '{{searchTermData}}' });
    mocks.llmChat.mockResolvedValue('# 提案');
    mocks.sendEmail.mockResolvedValue({ success: true });
  });

  it('当日試行済みフラグを立ててから LLM を呼び、成功時に送信日を記録する', async () => {
    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID)
    ).resolves.toStrictEqual({
      success: true,
      message: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_EMAIL_SENT,
    });

    const updates = mocks.updateSettings.mock.calls.map(call => call[1]);
    expect(updates[0]).toStrictEqual({ last_attempted_on: expect.any(String) });
    expect(updates[1]).toStrictEqual({ last_sent_on: expect.any(String), last_send_error: null });
    // 試行フラグは LLM 実行より前に立てる（途中で関数が落ちても同日再実行させないため）
    expect(mocks.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.llmChat.mock.invocationCallOrder[0]!
    );
  });

  it('LLM 呼び出しに timeoutMs を明示する', async () => {
    await googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID);

    expect(mocks.llmChat).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 240 * 1000 })
    );
  });

  it('試行フラグを立てられなければ LLM もメール送信も行わない', async () => {
    mocks.updateSettings.mockResolvedValue({
      success: false,
      error: { userMessage: '更新に失敗しました' },
    });

    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID)
    ).resolves.toStrictEqual({
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
    });
    expect(mocks.llmChat).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('抽出後にメール未登録が判明しても当日試行済みとエラーを記録する', async () => {
    mocks.getUserById.mockResolvedValue({ success: true, data: { email: null } });

    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID)
    ).resolves.toStrictEqual({
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_NEGATIVE_KEYWORDS_SUGGESTION,
    });

    expect(mocks.updateSettings.mock.calls.map(call => call[1])).toStrictEqual([
      { last_attempted_on: expect.any(String) },
      {
        last_send_error:
          ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_NEGATIVE_KEYWORDS_SUGGESTION,
      },
    ]);
    expect(mocks.llmChat).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('送信日の記録に失敗したら成功と報告しない', async () => {
    mocks.updateSettings
      .mockResolvedValueOnce({ success: true, data: undefined })
      .mockResolvedValueOnce({ success: false, error: { userMessage: '更新に失敗しました' } });

    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID)
    ).resolves.toStrictEqual({
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
    });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('Google Ads API のエラーは生メッセージではなく定義済み文言を保存する', async () => {
    mocks.getSearchTermMetrics.mockResolvedValue({
      success: false,
      error: 'Request contains an invalid argument.',
    });

    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID)
    ).resolves.toStrictEqual({
      success: false,
      error: ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED,
    });

    const updates = mocks.updateSettings.mock.calls.map(call => call[1]);
    expect(updates).toContainEqual({
      last_send_error: ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED,
    });
  });

  it('force=true（手動テスト送信）では試行日も送信日も記録しない', async () => {
    await expect(
      googleAdsNegativeKeywordsSuggestionService.sendNegativeKeywordsSuggestionForUser(USER_ID, {
        force: true,
      })
    ).resolves.toStrictEqual({
      success: true,
      message: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_EMAIL_SENT,
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
