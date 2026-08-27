import { SupabaseService } from '@/server/services/supabaseService';

/**
 * 未読改善提案の判定条件。
 *
 * **`suggestion_summary` が NULL の行を含めないこと。**
 * この判定が出す数はトーストの「N件のコンテンツに改善提案があります」と、一覧のベル
 * アイコン（`app/analytics/page.tsx` → `AnalyticsTable.tsx`）の両方になる。どちらも
 * 「提案文が存在する」という主張なので、生成前・生成失敗の行を数に入れると嘘になる。
 *
 * 実害は「まだ出ていないものを通知する」だけでは済まない。提案文の生成は3回失敗すると
 * `suggestion_next_retry_at = null` で打ち切られ二度と拾われない（`gscSuggestionJobService`）。
 * その行は `evaluation-history-view.ts` の `canMarkAsRead` が `Boolean(suggestion_summary)` を
 * 要求するため**既読ボタンが出ず**、トーストは `duration: Infinity` なので、
 * **ユーザーが消す手段の無い通知が residual に残る**。
 * 恒久失敗は実際に起きている（`docs/runbooks/gsc-suggestion-timeout-recovery-2026-07-12.md`
 * に 171件中8件が `suggestion_summary IS NULL` のまま残った記録がある）。
 *
 * ~~get_filtered_content_annotations の p_has_unread_suggestion EXISTS 句と揃える。~~
 * → 2026-08-26 撤回。RPC 側が `suggestion_summary` を見ていないのは事実だが、**揃える方向が
 * 逆だった**。RPC の述語は一覧フィルタ（「未読の評価結果がある記事に絞る」）用で、提案文の
 * 有無を主張しない。**通知と一覧フィルタで条件が違うのは意図的**であり、不整合として
 * 揃え直さないこと。
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
      .neq('outcome', 'improved')
      .not('suggestion_summary', 'is', null);
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
