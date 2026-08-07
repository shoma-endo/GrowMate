import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listDue: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    listDueGoogleAdsNegativeKeywordsSettings = mocks.listDue;
  },
}));

vi.mock('@/server/services/googleAdsService', () => ({
  GoogleAdsService: class {},
}));

vi.mock('@/server/services/emailService', () => ({
  EmailService: class {},
  emailService: {},
}));

vi.mock('@/server/services/llmService', () => ({
  llmChat: vi.fn(),
}));

vi.mock('@/server/services/briefService', () => ({
  briefService: { getVariablesByUserId: vi.fn() },
}));

vi.mock('@/server/services/promptService', () => ({
  PromptService: { getTemplateByName: vi.fn() },
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

  it('経過時間が予算ちょうどなら次チャンクを開始する（境界は超過時のみ打ち切り）', async () => {
    mocks.listDue.mockResolvedValue({ success: true, data: dueSettings(6) });
    // 1 ユーザーごとに予算 / 3 を進めるため、1 チャンク後の経過時間は予算と完全に一致する
    stubSendWithElapsed(BATCH_TIME_LIMIT_MS / 3);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).resolves.toStrictEqual({
      total: 6,
      succeeded: 6,
      failed: 0,
      skipped: 0,
    });
  });

  it('時間予算内なら全ユーザーを処理し打ち切り情報を返さない', async () => {
    mocks.listDue.mockResolvedValue({ success: true, data: dueSettings(9) });
    const send = stubSendWithElapsed(1000);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).resolves.toStrictEqual({
      total: 9,
      succeeded: 9,
      failed: 0,
      skipped: 0,
    });
    expect(send).toHaveBeenCalledTimes(9);
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
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions()
    ).rejects.toThrow('設定の取得に失敗しました');
    expect(
      error.mock.calls
        .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
        .map(log => log.event)
    ).toContain('batch_failed');
  });
});
