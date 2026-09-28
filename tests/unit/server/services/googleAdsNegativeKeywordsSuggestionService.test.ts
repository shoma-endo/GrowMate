import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const mocks = vi.hoisted(() => ({
  listDue: vi.fn(),
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
    listDueGoogleAdsNegativeKeywordsSettings = mocks.listDue;
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

import {
  googleAdsNegativeKeywordsSuggestionService,
  NEGATIVE_KEYWORDS_CRON_MAX_DURATION_SEC,
} from '@/server/services/googleAdsNegativeKeywordsSuggestionService';

// 実装値: CRON_MAX_DURATION_MS(800s) - USER_TIME_LIMIT_MS(LLM 240s + I/O 60s) - SAFETY_MARGIN_MS(20s)
const BATCH_TIME_LIMIT_MS = 480 * 1000;

const dueSettings = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    userId: `user-${index}`,
    enabled: true,
    sendHourJst: 7,
    lastSentOn: null,
    lastAttemptedOn: null,
    lastSendError: null,
  }));

/**
 * `sendNegativeKeywordsSuggestionForUser` を差し替え、1 回の呼び出しごとに
 * フェイククロックを `perUserMs` だけ進める。並列実行をシミュレートするものではなく、
 * チャンクループの時間判定にかかる経過時間だけを制御するためのもの。
 */
const stubSendWithElapsed = (
  perUserMs: number,
  result: { success: boolean; skipped?: boolean } = { success: true }
) =>
  vi
    .spyOn(googleAdsNegativeKeywordsSuggestionService, 'sendNegativeKeywordsSuggestionForUser')
    .mockImplementation(async () => {
      vi.advanceTimersByTime(perUserMs);
      return result;
    });

describe('googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T07:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('時間予算を超えたら次チャンクに入らず残りを skippedDueToLimit に計上する', async () => {
    mocks.listDue.mockResolvedValue({ success: true, data: dueSettings(9) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // 1 チャンク（3 ユーザー）で 600 秒経過 → 2 チャンク目は予算 480 秒を超えて開始されない
    const send = stubSendWithElapsed(200 * 1000);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).resolves.toStrictEqual({
      total: 3,
      succeeded: 3,
      failed: 0,
      skipped: 0,
      stoppedReason: 'time_limit',
      skippedDueToLimit: 6,
    });
    // 抽出順の先頭から処理し、途中のユーザーを飛ばさない
    expect(send.mock.calls.map(call => call[0])).toStrictEqual(['user-0', 'user-1', 'user-2']);
    const completedLog = info.mock.calls
      .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find(log => log.event === 'batch_completed');
    expect(completedLog).toMatchObject({
      total: 9,
      succeeded: 3,
      failed: 0,
      skipped: 6,
    });
  });

  it('経過時間が予算以内なら全ユーザーを処理し打ち切り情報を返さない（ちょうどでも打ち切らない）', async () => {
    mocks.listDue.mockResolvedValue({ success: true, data: dueSettings(6) });
    // 1 ユーザーごとに予算 / 3 を進めるため、1 チャンク後の経過時間は予算と完全に一致する
    const send = stubSendWithElapsed(BATCH_TIME_LIMIT_MS / 3);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).resolves.toStrictEqual({
      total: 6,
      succeeded: 6,
      failed: 0,
      skipped: 0,
    });
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('失敗・スキップ・例外をそれぞれ集計する', async () => {
    mocks.listDue.mockResolvedValue({ success: true, data: dueSettings(3) });
    vi.spyOn(
      googleAdsNegativeKeywordsSuggestionService,
      'sendNegativeKeywordsSuggestionForUser'
    ).mockImplementation(async userId => {
      if (userId === 'user-0') {
        return { success: false, error: 'failed' };
      }
      if (userId === 'user-1') {
        return { success: true, skipped: true };
      }
      throw new Error('unexpected');
    });

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).resolves.toStrictEqual({
      total: 3,
      succeeded: 0,
      failed: 2,
      skipped: 1,
    });
  });

  // Next.js の segment config はリテラルしか受け付けないため route 側は定数を import できない。
  // 時間予算は maxDuration から逆算しているので、値がずれると予算が破綻する。
  it('route の maxDuration と時間予算の前提値が一致している', () => {
    const routeSource = readFileSync(
      'app/api/cron/google-ads-negative-keywords-suggestion/route.ts',
      'utf8'
    );
    const literal = routeSource.match(/export const maxDuration = (\d+)/)?.[1];

    expect(Number(literal)).toBe(NEGATIVE_KEYWORDS_CRON_MAX_DURATION_SEC);
  });

  it('対象一覧の取得に失敗したら例外を投げる', async () => {
    mocks.listDue.mockResolvedValue({
      success: false,
      error: { userMessage: '設定の取得に失敗しました' },
    });

    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).rejects.toThrow('設定の取得に失敗しました');
  });
});

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
