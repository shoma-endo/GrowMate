import { SupabaseService } from '@/server/services/supabaseService';
import type { UserRole } from '@/types/user';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const DAILY_CHAT_LIMIT = 3;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getCurrentJstRange() {
  const nowUtc = new Date();
  const nowJst = new Date(nowUtc.getTime() + JST_OFFSET_MS);
  const startOfJstUtcMs = Date.UTC(
    nowJst.getUTCFullYear(),
    nowJst.getUTCMonth(),
    nowJst.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const fromUtcMs = startOfJstUtcMs - JST_OFFSET_MS;
  const toUtcMs = fromUtcMs + 24 * 60 * 60 * 1000;

  return {
    fromUtcIso: new Date(fromUtcMs).toISOString(),
    toUtcIso: new Date(toUtcMs).toISOString(),
  };
}

/**
 * trial ユーザーの送信（通常・続き生成とも）を、生成の前に1回分予約する。
 * 当日の予約が上限に達していれば、または予約できなければエラー文言を返す（呼び出し元は生成しない）。
 * 予約した後に生成が失敗しても枠は戻さない。
 */
export async function reserveTrialChatSend(role: UserRole, userId: string): Promise<string | null> {
  if (role !== 'trial') {
    return null;
  }

  const { fromUtcIso, toUtcIso } = getCurrentJstRange();
  const result = await new SupabaseService().reserveTrialChatSend(userId, fromUtcIso, toUtcIso, DAILY_CHAT_LIMIT);

  if (!result.success) {
    console.error('[ChatLimitService] Failed to reserve trial chat send:', result.error);
    return result.error.userMessage;
  }
  return result.data ? null : ERROR_MESSAGES.CHAT.DAILY_CHAT_LIMIT;
}
