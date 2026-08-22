import { SupabaseService } from '@/server/services/supabaseService';

/**
 * 未読改善提案の判定条件。
 * get_filtered_content_annotations の p_has_unread_suggestion EXISTS 句と揃える。
 */
const UNREAD_SUGGESTION_HISTORY_COLUMNS = 'content_annotation_id' as const;

class GscNotificationService {
  private readonly supabaseService = new SupabaseService();

  private unreadSuggestionsQuery(userId: string) {
    return this.supabaseService
      .getClient()
      .from('gsc_article_evaluation_history')
      .select(UNREAD_SUGGESTION_HISTORY_COLUMNS)
      .eq('user_id', userId)
      .eq('is_read', false)
      .neq('outcome_type', 'error')
      .not('outcome', 'is', null)
      .neq('outcome', 'improved');
  }

  async getAnnotationIdsWithUnreadSuggestions(
    userId: string
  ): Promise<{ annotationIds: string[] }> {
    const { data, error } = await this.unreadSuggestionsQuery(userId);

    if (error) {
      console.error('Error fetching annotation ids with unread suggestions:', error);
      return { annotationIds: [] };
    }

    const annotationIds = [...new Set(data?.map(row => row.content_annotation_id) ?? [])];
    return { annotationIds };
  }

  async getUnreadSuggestionsAnnotationCount(userId: string): Promise<number> {
    const { annotationIds } = await this.getAnnotationIdsWithUnreadSuggestions(userId);
    return annotationIds.length;
  }
}

export const gscNotificationService = new GscNotificationService();
