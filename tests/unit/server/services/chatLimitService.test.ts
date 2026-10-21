import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const mocks = vi.hoisted(() => ({
  countUserMessagesBetween: vi.fn(),
  countChatContinuationsBetween: vi.fn(),
  recordChatContinuation: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    countUserMessagesBetween = mocks.countUserMessagesBetween;
    countChatContinuationsBetween = mocks.countChatContinuationsBetween;
    recordChatContinuation = mocks.recordChatContinuation;
  },
}));

import { checkTrialDailyLimit, recordTrialContinuation } from '@/server/services/chatLimitService';

const ok = (data: number | null) => ({ success: true, data });
const failure = { success: false, error: { userMessage: ERROR_MESSAGES.CHAT.USAGE_CHECK_FAILED } };

describe('checkTrialDailyLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('続き生成は user メッセージを残さないので、記録した件数も足して上限を判定する', async () => {
    mocks.countUserMessagesBetween.mockResolvedValue(ok(1));
    mocks.countChatContinuationsBetween.mockResolvedValue(ok(2));

    await expect(checkTrialDailyLimit('trial', 'user-1')).resolves.toBe(ERROR_MESSAGES.CHAT.DAILY_CHAT_LIMIT);
  });

  it('合計が上限未満なら通す', async () => {
    mocks.countUserMessagesBetween.mockResolvedValue(ok(1));
    mocks.countChatContinuationsBetween.mockResolvedValue(ok(1));

    await expect(checkTrialDailyLimit('trial', 'user-1')).resolves.toBeNull();
  });

  it('続き生成の件数を数えられなければ通さない', async () => {
    mocks.countUserMessagesBetween.mockResolvedValue(ok(0));
    mocks.countChatContinuationsBetween.mockResolvedValue(failure);

    await expect(checkTrialDailyLimit('trial', 'user-1')).resolves.toBe(ERROR_MESSAGES.CHAT.USAGE_CHECK_FAILED);
  });

  it('trial 以外は数えない', async () => {
    await expect(checkTrialDailyLimit('paid', 'user-1')).resolves.toBeNull();
    expect(mocks.countUserMessagesBetween).not.toHaveBeenCalled();
  });
});

describe('recordTrialContinuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trial の続き生成を記録する', async () => {
    mocks.recordChatContinuation.mockResolvedValue(ok(null));

    await expect(recordTrialContinuation('trial', 'user-1')).resolves.toBeNull();
    expect(mocks.recordChatContinuation).toHaveBeenCalledWith('user-1');
  });

  it('記録に失敗したら、上限をすり抜けないようエラー文言を返す', async () => {
    mocks.recordChatContinuation.mockResolvedValue(failure);

    await expect(recordTrialContinuation('trial', 'user-1')).resolves.toBe(ERROR_MESSAGES.CHAT.USAGE_CHECK_FAILED);
  });

  it('trial 以外は記録しない', async () => {
    await expect(recordTrialContinuation('admin', 'user-1')).resolves.toBeNull();
    expect(mocks.recordChatContinuation).not.toHaveBeenCalled();
  });
});
