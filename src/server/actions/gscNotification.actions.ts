'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { gscNotificationService } from '@/server/services/gscNotificationService';

const supabaseService = new SupabaseService();

type GscNotificationAuthResult =
  | { userId: string }
  | { error: string; emailLinkConflict?: true };

const getAuthUserId = async (): Promise<GscNotificationAuthResult> => {
  const authResult = await authMiddleware();
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return { ...linkConflict, emailLinkConflict: true as const };
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  return { userId: authResult.userId };
};

/**
 * 未読のGSC改善提案があるコンテンツ件数を取得する（グローバル通知用）
 * 評価履歴行数ではなく content_annotation_id のユニーク数を返す。
 */
export async function getUnreadSuggestionsCount(): Promise<{ count: number }> {
  const auth = await getAuthUserId();
  if ('error' in auth) {
    return { count: 0 };
  }

  const count = await gscNotificationService.getUnreadSuggestionsAnnotationCount(auth.userId);
  return { count };
}

/**
 * 改善提案を既読にする
 */
export async function markSuggestionAsRead(historyId: string): Promise<{ success: boolean; error?: string }> {
  const auth = await getAuthUserId();
  if ('error' in auth) {
    return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.UNAUTHORIZED };
  }
  const { userId } = auth;

  const { error: updateError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .update({ is_read: true })
    .eq('id', historyId)
    .eq('user_id', userId);

  if (updateError) {
    console.error('Error marking suggestion as read:', updateError);
    return { success: false, error: updateError.message };
  }

  revalidatePath('/');
  revalidatePath('/analytics');
  revalidatePath('/analytics/[annotationId]', 'page');
  return { success: true };
}
