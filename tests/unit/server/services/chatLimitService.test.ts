import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const reserveMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    reserveTrialChatSend = reserveMock;
  },
}));

import { reserveTrialChatSend } from '@/server/services/chatLimitService';

describe('reserveTrialChatSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trial は当日（日本時間）の範囲と上限3回で予約し、予約できれば通す', async () => {
    reserveMock.mockResolvedValue({ success: true, data: true });

    await expect(reserveTrialChatSend('trial', 'user-1')).resolves.toBeNull();

    const [userId, fromIso, toIso, limit] = reserveMock.mock.calls[0]!;
    expect(userId).toBe('user-1');
    expect(new Date(toIso).getTime() - new Date(fromIso).getTime()).toBe(24 * 60 * 60 * 1000);
    expect(new Date(fromIso).getUTCHours()).toBe(15);
    expect(limit).toBe(3);
  });

  it('上限に達して予約できなければ、日次上限の文言を返す', async () => {
    reserveMock.mockResolvedValue({ success: true, data: false });

    await expect(reserveTrialChatSend('trial', 'user-1')).resolves.toBe(ERROR_MESSAGES.CHAT.DAILY_CHAT_LIMIT);
  });

  it('予約の処理に失敗したら、生成させないようエラー文言を返す', async () => {
    reserveMock.mockResolvedValue({
      success: false,
      error: { userMessage: ERROR_MESSAGES.CHAT.USAGE_CHECK_FAILED },
    });

    await expect(reserveTrialChatSend('trial', 'user-1')).resolves.toBe(ERROR_MESSAGES.CHAT.USAGE_CHECK_FAILED);
  });

  it('trial 以外は予約しない', async () => {
    await expect(reserveTrialChatSend('paid', 'user-1')).resolves.toBeNull();
    expect(reserveMock).not.toHaveBeenCalled();
  });
});
