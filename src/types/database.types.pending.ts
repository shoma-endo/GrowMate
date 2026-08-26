import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// リモート未適用の migration に対応する暫定型。適用・`npm run supabase:types` 実行後、
// 該当ブロックを削除し呼び出し側を生成型へ切り替える（.agents/skills/supabase/service-usage.md §6）。

export function asPendingClient<TDatabase>(
  client: SupabaseClient<Database>
): SupabaseClient<TDatabase> {
  return client as unknown as SupabaseClient<TDatabase>;
}

// PROVISIONAL: supabase/migrations/20260826000000_merge_ga4_content_evaluation_into_gsc_cycle.sql
//
// GSC検索順位評価サイクルとGA4コンテンツ評価サイクルを1本へ統合した際に、
// gsc_article_evaluations へ追加した GA4 側の実行進捗3列。
// スケジュール設定（base_evaluation_date / cycle_days / evaluation_hour）は生成型に既にある。
type Ga4EvaluationProgressColumns = {
  ga4_last_evaluated_on: string | null;
  ga4_last_seen_content_score: number | null;
  ga4_last_notified_history_id: string | null;
};

type GscArticleEvaluationsTable = Database['public']['Tables']['gsc_article_evaluations'];

/** due抽出RPC `list_due_ga4_content_evaluations` の戻り値1行 */
export type Ga4DueEvaluationRow = {
  id: string;
  user_id: string;
  content_annotation_id: string;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour: number;
  ga4_last_evaluated_on: string | null;
  ga4_last_seen_content_score: number | null;
  /** RPC が算出する「次にGA4評価を行う日」。coalesce(ga4_last_evaluated_on, base_evaluation_date) + cycle_days */
  ga4_next_evaluation_date: string;
};

export type Ga4ContentEvaluationScheduleDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Omit<Database['public']['Tables'], 'gsc_article_evaluations'> & {
      gsc_article_evaluations: Omit<GscArticleEvaluationsTable, 'Row' | 'Insert' | 'Update'> & {
        Row: GscArticleEvaluationsTable['Row'] & Ga4EvaluationProgressColumns;
        Insert: GscArticleEvaluationsTable['Insert'] & Partial<Ga4EvaluationProgressColumns>;
        Update: GscArticleEvaluationsTable['Update'] & Partial<Ga4EvaluationProgressColumns>;
      };
    };
    Functions: Database['public']['Functions'] & {
      list_due_ga4_content_evaluations: {
        Args: { p_today_jst: string };
        Returns: Ga4DueEvaluationRow[];
      };
    };
  };
};
