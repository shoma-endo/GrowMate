import { SupabaseService } from '@/server/services/supabaseService';

class GscNotificationService {
  private readonly supabaseService = new SupabaseService();

  async getAnnotationIdsWithUnreadSuggestions(
    userId: string
  ): Promise<{ annotationIds: string[] }> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('gsc_article_evaluation_history')
      .select('content_annotation_id')
      .eq('user_id', userId)
      .eq('is_read', false)
      .neq('outcome_type', 'error')
      .not('outcome', 'is', null)
      .neq('outcome', 'improved')
      .not('suggestion_summary', 'is', null);

    if (error) {
      console.error('Error fetching annotation ids with unread suggestions:', error);
      return { annotationIds: [] };
    }

    const annotationIds = [...new Set(data?.map(row => row.content_annotation_id) ?? [])];
    return { annotationIds };
  }
}

export const gscNotificationService = new GscNotificationService();
