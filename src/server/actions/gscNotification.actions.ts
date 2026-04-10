'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { hasOwnerRole } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { AuthEmailLinkConflictError } from '@/domain/errors/AuthEmailLinkConflictError';

const supabaseService = new SupabaseService();

type GscNotificationAuthResult =
  | { userId: string }
  | { error: string; emailLinkConflict?: true };

const getAuthUserId = async (): Promise<GscNotificationAuthResult> => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();

  const authResult = await authMiddleware(accessToken, refreshToken);
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return { ...linkConflict, emailLinkConflict: true as const };
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  if (hasOwnerRole(authResult.userDetails?.role ?? null)) {
    return { error: ERROR_MESSAGES.USER.VIEW_MODE_NOT_ALLOWED };
  }
  return { userId: authResult.userId };
};

/**
 * 未読のGSC改善提案の件数のみを取得する（グローバル通知用の軽量版）
 */
export async function getUnreadSuggestionsCount(): Promise<{ count: number }> {
  const auth = await getAuthUserId();
  if ('error' in auth) {
    return { count: 0 };
  }
  const { userId } = auth;

  const { count, error: queryError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .neq('outcome_type', 'error')
    .not('outcome', 'is', null)
    .neq('outcome', 'improved');

  if (queryError) {
    console.error('Error fetching unread suggestions count:', queryError);
    return { count: 0 };
  }

  return { count: count ?? 0 };
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
  revalidatePath('/gsc-dashboard');
  return { success: true };
}

/**
 * 指定したannotation_idに紐づく未読の改善提案IDリストを取得する
 * AnalyticsTableでの🔔バッジ表示用
 */
export async function getAnnotationIdsWithUnreadSuggestions(): Promise<{ annotationIds: string[] }> {
  const auth = await getAuthUserId();
  if ('error' in auth) {
    if (auth.emailLinkConflict) {
      throw new AuthEmailLinkConflictError(auth.error);
    }
    return { annotationIds: [] };
  }
  const { userId } = auth;

  const { data, error: queryError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .select('content_annotation_id')
    .eq('user_id', userId)
    .eq('is_read', false)
    .neq('outcome_type', 'error')
    .not('outcome', 'is', null)
    .neq('outcome', 'improved');

  if (queryError) {
    console.error('Error fetching annotation ids with unread suggestions:', queryError);
    return { annotationIds: [] };
  }

  // 重複を除去してリストを返す
  const uniqueIds = [...new Set(data?.map(d => d.content_annotation_id) ?? [])];
  return { annotationIds: uniqueIds };
}
