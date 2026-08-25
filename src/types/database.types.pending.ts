import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// リモート未適用の migration に対応する暫定型。適用・`npm run supabase:types` 実行後、
// 該当ブロックを削除し呼び出し側を生成型へ切り替える（.agents/skills/supabase/service-usage.md §6）。

export function asPendingClient<TDatabase>(
  client: SupabaseClient<Database>
): SupabaseClient<TDatabase> {
  return client as unknown as SupabaseClient<TDatabase>;
}

// PROVISIONAL: supabase/migrations/20260824000000_create_ga4_content_evaluation_cycles.sql
type Ga4ContentEvaluationCycleStatus = 'active' | 'paused' | 'completed';
type Ga4ContentEvaluationCycleNotificationStatus = 'sent' | 'skipped_no_email' | 'failed';
type Ga4ContentEvaluationCycleRow = {
  id: string;
  user_id: string;
  content_annotation_id: string;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour: number;
  status: Ga4ContentEvaluationCycleStatus;
  last_evaluated_on: string | null;
  last_seen_content_score: number | null;
  next_evaluation_date: string;
  last_notified_history_id: string | null;
  last_notification_status: Ga4ContentEvaluationCycleNotificationStatus | null;
  last_notification_error: string | null;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

// PROVISIONAL: supabase/migrations/20260824000200_add_list_due_ga4_content_evaluation_cycles_rpc.sql
type Ga4DueContentEvaluationCycleRow = Pick<
  Ga4ContentEvaluationCycleRow,
  | 'id'
  | 'user_id'
  | 'content_annotation_id'
  | 'base_evaluation_date'
  | 'cycle_days'
  | 'evaluation_hour'
  | 'last_evaluated_on'
  | 'last_seen_content_score'
  | 'next_evaluation_date'
>;

export type Ga4ContentEvaluationCycleDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Omit<Database['public']['Tables'], 'ga4_content_evaluation_cycles'> & {
      ga4_content_evaluation_cycles: {
        Row: Ga4ContentEvaluationCycleRow;
        Insert: Pick<Ga4ContentEvaluationCycleRow, 'user_id' | 'content_annotation_id' | 'base_evaluation_date'> &
          Partial<
            Omit<
              Ga4ContentEvaluationCycleRow,
              'id' | 'user_id' | 'content_annotation_id' | 'base_evaluation_date' | 'next_evaluation_date' | 'created_at' | 'updated_at'
            >
          >;
        Update: Partial<Omit<Ga4ContentEvaluationCycleRow, 'id' | 'next_evaluation_date'>>;
        Relationships: [];
      };
    };
    Functions: Database['public']['Functions'] & {
      list_due_ga4_content_evaluation_cycles: {
        Args: { p_today_jst: string };
        Returns: Ga4DueContentEvaluationCycleRow[];
      };
    };
  };
};
