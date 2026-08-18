import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types';

// PROVISIONAL: supabase/migrations/20260809100000_add_gsc_unstarted_evaluation_filter.sql
// マイグレーション適用後に `npm run supabase:types` を実行し、
// get_filtered_content_annotations の生成型へ切り替える。
type FilteredContentAnnotationsFunction =
  Database['public']['Functions']['get_filtered_content_annotations'];

export type AnalyticsDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], 'get_filtered_content_annotations'> & {
      get_filtered_content_annotations: {
        Args: FilteredContentAnnotationsFunction['Args'] & {
          p_has_unstarted_gsc_evaluation?: boolean;
          p_has_unstarted_ga4_evaluation?: boolean;
        };
        Returns: FilteredContentAnnotationsFunction['Returns'];
      };
    };
  };
};

export function asPendingClient<TDatabase>(
  client: SupabaseClient<Database>
): SupabaseClient<TDatabase> {
  return client as unknown as SupabaseClient<TDatabase>;
}

// PROVISIONAL: supabase/migrations/20260814000000_add_cached_thumbnail_path_to_instagram_media.sql
// マイグレーション適用後に `npm run supabase:types` を実行し、instagram_media の生成型に
// cached_thumbnail_path が含まれるようになったら、本ブロックと
// asPendingClient<InstagramMediaDatabase>(...) の呼び出しを削除して通常の client に戻す。
type InstagramMediaTable = Database['public']['Tables']['instagram_media'];

export type InstagramMediaDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'instagram_media'> & {
      instagram_media: {
        Row: InstagramMediaTable['Row'] & { cached_thumbnail_path: string | null };
        Insert: InstagramMediaTable['Insert'] & { cached_thumbnail_path?: string | null };
        Update: InstagramMediaTable['Update'] & { cached_thumbnail_path?: string | null };
        Relationships: InstagramMediaTable['Relationships'];
      };
    };
  };
};

// PROVISIONAL: supabase/migrations/20260818000000_add_ga4_engagement_metrics_and_image_count.sql
// マイグレーション適用後に生成型を更新し、この型と asPendingClient 呼び出しを削除する。
type Ga4MetricsTable = Database['public']['Tables']['ga4_page_metrics_daily'];
type ContentAnnotationsTable = Database['public']['Tables']['content_annotations'];

export type Ga4PendingDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'ga4_page_metrics_daily' | 'content_annotations'> & {
      ga4_page_metrics_daily: {
        Row: Ga4MetricsTable['Row'] & { engagement_rate: number | null; active_users: number | null };
        Insert: Ga4MetricsTable['Insert'] & { engagement_rate?: number | null; active_users?: number | null };
        Update: Ga4MetricsTable['Update'] & { engagement_rate?: number | null; active_users?: number | null };
        Relationships: Ga4MetricsTable['Relationships'];
      };
      content_annotations: {
        Row: ContentAnnotationsTable['Row'] & { wp_image_count: number | null };
        Insert: ContentAnnotationsTable['Insert'] & { wp_image_count?: number | null };
        Update: ContentAnnotationsTable['Update'] & { wp_image_count?: number | null };
        Relationships: ContentAnnotationsTable['Relationships'];
      };
    };
  };
};

// PROVISIONAL: supabase/migrations/20260818000100_create_ga4_content_evaluation_tables.sql
// PROVISIONAL: supabase/migrations/20260818000200_add_ga4_content_evaluation_rpcs.sql
type Ga4EvaluationStatus =
  | 'evaluated' | 'narrative_failed' | 'insufficient_data' | 'import_failed'
  | 'evaluation_failed' | 'evaluating';
type Ga4EvaluationRow = {
  id: string;
  user_id: string;
  content_annotation_id: string;
  status: Ga4EvaluationStatus;
  active_run_id: string | null;
  last_success_history_id: string | null;
  last_success_evaluated_at: string | null;
  evaluation_started_at: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};
type Ga4EvaluationHistoryRow = {
  id: string;
  evaluation_run_id: string;
  user_id: string;
  content_annotation_id: string;
  status: Ga4EvaluationStatus;
  started_at: string;
  completed_at: string | null;
  attempt_count: number;
  read_rate: number | null;
  engage_rate: number | null;
  scroll_rate: number | null;
  read_score: number | null;
  engage_score: number | null;
  content_score: number | null;
  diagnosis_code: string | null;
  site_rank: number | null;
  total_articles: number | null;
  sessions: number | null;
  char_count: number | null;
  image_count: number | null;
  expected_read_seconds: number | null;
  avg_engagement_seconds: number | null;
  narrative_json: Json;
  data_quality_json: Json;
  period_start: string | null;
  period_end: string | null;
  canonical_url_snapshot: string | null;
  title_snapshot: string | null;
  ga4_property_id: string | null;
  ga4_data_fetched_at: string | null;
  context_schema_version: number;
  input_fingerprint: string | null;
  scoring_config_version: number;
  prompt_template_id: string | null;
  prompt_version_id: string | null;
  prompt_version: number | null;
  prompt_captured_at: string | null;
  prompt_content_sha256: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
type Ga4EvaluationSettingsRow = { id: number; enabled: boolean; updated_at: string; updated_by: string | null };

export type Ga4EvaluationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Omit<Database['public']['Tables'], 'ga4_content_evaluations' | 'ga4_content_evaluation_history' | 'ga4_content_evaluation_settings'> & {
      ga4_content_evaluations: {
        Row: Ga4EvaluationRow;
        Insert: Pick<Ga4EvaluationRow, 'user_id' | 'content_annotation_id' | 'status'> & Partial<Omit<Ga4EvaluationRow, 'id' | 'user_id' | 'content_annotation_id' | 'status' | 'created_at' | 'updated_at'>>;
        Update: Partial<Ga4EvaluationRow>;
        Relationships: [];
      };
      ga4_content_evaluation_history: {
        Row: Ga4EvaluationHistoryRow;
        Insert: Pick<Ga4EvaluationHistoryRow, 'evaluation_run_id' | 'user_id' | 'content_annotation_id' | 'status' | 'scoring_config_version'> & Partial<Omit<Ga4EvaluationHistoryRow, 'id' | 'evaluation_run_id' | 'user_id' | 'content_annotation_id' | 'status' | 'scoring_config_version' | 'created_at' | 'updated_at'>>;
        Update: Partial<Ga4EvaluationHistoryRow>;
        Relationships: [];
      };
      ga4_content_evaluation_settings: {
        Row: Ga4EvaluationSettingsRow;
        Insert: Pick<Ga4EvaluationSettingsRow, 'id' | 'enabled'> & Partial<Omit<Ga4EvaluationSettingsRow, 'id' | 'enabled'>>;
        Update: Partial<Ga4EvaluationSettingsRow>;
        Relationships: [];
      };
    };
    Functions: Database['public']['Functions'] & {
      start_ga4_content_evaluation: {
        Args: { p_user_id: string; p_content_annotation_id: string };
        Returns: Array<{ evaluation_run_id: string }>;
      };
      finish_ga4_content_evaluation: {
        Args: {
          p_user_id: string; p_content_annotation_id: string; p_evaluation_run_id: string; p_status: string;
          p_error_code?: string | null; p_error_message?: string | null; p_attempt_count?: number;
          p_read_rate?: number | null; p_engage_rate?: number | null; p_scroll_rate?: number | null;
          p_read_score?: number | null; p_engage_score?: number | null; p_content_score?: number | null;
          p_diagnosis_code?: string | null; p_site_rank?: number | null; p_total_articles?: number | null;
          p_sessions?: number | null; p_char_count?: number | null; p_image_count?: number | null;
          p_expected_read_seconds?: number | null; p_avg_engagement_seconds?: number | null;
          p_narrative_json?: Json; p_data_quality_json?: Json; p_period_start?: string | null; p_period_end?: string | null;
          p_canonical_url_snapshot?: string | null; p_title_snapshot?: string | null; p_ga4_property_id?: string | null;
          p_ga4_data_fetched_at?: string | null; p_scoring_config_version?: number;
          p_input_fingerprint?: string | null;
          p_prompt_template_id?: string | null; p_prompt_version_id?: string | null; p_prompt_version?: number | null;
          p_prompt_captured_at?: string | null; p_prompt_content_sha256?: string | null;
        };
        Returns: boolean;
      };
      update_ga4_content_evaluation_attempt: {
        Args: { p_user_id: string; p_content_annotation_id: string; p_evaluation_run_id: string; p_attempt_count: number };
        Returns: boolean;
      };
      cancel_ga4_content_evaluation: {
        Args: { p_user_id: string; p_content_annotation_id: string; p_evaluation_run_id: string };
        Returns: boolean;
      };
    };
  };
};
