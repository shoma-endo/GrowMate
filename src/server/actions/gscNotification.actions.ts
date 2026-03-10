'use server';

import { revalidatePath } from 'next/cache';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { hasOwnerRole } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';

export interface UnreadSuggestion {
  id: string;
  evaluation_date: string;
  url: string;
  keyword: string;
  suggestion_summary: string | null;
  outcome: 'improved' | 'no_change' | 'worse';
  previous_position: number | null;
  current_position: number;
}

export interface UnreadSuggestionsResponse {
  count: number;
  suggestions: UnreadSuggestion[];
}

const supabaseService = new SupabaseService();

const getAuthUserId = async () => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();

  const authResult = await authMiddleware(accessToken, refreshToken);
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
  const { userId, error } = await getAuthUserId();
  if (error || !userId) {
    return { count: 0 };
  }

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
 * 未読のGSC改善提案を取得する
 */
export async function getUnreadSuggestions(): Promise<UnreadSuggestionsResponse> {
  const { userId, error } = await getAuthUserId();
  if (error || !userId) {
    return { count: 0, suggestions: [] };
  }

  const { data, error: queryError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .select(`
      id,
      evaluation_date,
      suggestion_summary,
      outcome,
      previous_position,
      current_position,
      content_annotations!inner (
        id,
        target_keyword
      ),
      gsc_article_evaluations!inner (
        property_uri
      )
    `)
    .eq('user_id', userId)
    .eq('is_read', false)
    .neq('outcome_type', 'error')
    .not('outcome', 'is', null)
    .neq('outcome', 'improved')
    .order('evaluation_date', { ascending: false });

  if (queryError) {
    console.error('Error fetching unread suggestions:', queryError);
    return { count: 0, suggestions: [] };
  }

  if (!data || data.length === 0) {
    return { count: 0, suggestions: [] };
  }

  // クライアント向けに整形
  const suggestions: UnreadSuggestion[] = data.map((item: any) => ({
    id: item.id,
    evaluation_date: item.evaluation_date,
    url: item.gsc_article_evaluations?.property_uri || '',
    keyword: item.content_annotations?.target_keyword || '',
    suggestion_summary: item.suggestion_summary,
    outcome: item.outcome,
    previous_position: item.previous_position,
    current_position: item.current_position,
  }));

  return {
    count: suggestions.length,
    suggestions,
  };
}

/**
 * 改善提案を既読にする
 */
export async function markSuggestionAsRead(historyId: string): Promise<{ success: boolean; error?: string }> {
  const { userId, error } = await getAuthUserId();
  if (error || !userId) {
    return { success: false, error: error || ERROR_MESSAGES.AUTH.UNAUTHORIZED };
  }

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
 * 全ての改善提案を既読にする
 */
export async function markAllSuggestionsAsRead(): Promise<{ success: boolean; error?: string }> {
  const { userId, error } = await getAuthUserId();
  if (error || !userId) {
    return { success: false, error: error || ERROR_MESSAGES.AUTH.UNAUTHORIZED };
  }

  const { error: updateError } = await supabaseService
    .getClient()
    .from('gsc_article_evaluation_history')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (updateError) {
    console.error('Error marking all suggestions as read:', updateError);
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
  const { userId, error } = await getAuthUserId();
  if (error || !userId) {
    return { annotationIds: [] };
  }

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
