import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './database.types';

/**
 * 生成型（`database.types.ts`）を部分的に差し替えて Supabase クライアントを使うための型置き場。
 *
 * 用途は2つある。混ぜないこと。
 *
 * 1. **リモート未適用の migration に対応する暫定型**（`PROVISIONAL:` を付ける）。
 *    適用・`npm run supabase:types` 実行後に該当ブロックを削除し、呼び出し側を生成型へ戻す
 *    （`.agents/skills/supabase/service-usage.md` §6）。
 * 2. **生成型の取りこぼしを恒久的に補正する型**（`PERMANENT:` を付ける）。
 *    `supabase gen types` の既知の限界を埋めるもので、migration を適用しても消えない。
 *
 * **差し替えは必ず `Omit` で置換すること。** 交差（`&`）にすると、生成型の
 * `string` と補正の `string | null` が `string` に潰れ、**補正が無言で無効化される**。
 */
export function asPendingClient<TDatabase>(
  client: SupabaseClient<Database>
): SupabaseClient<TDatabase> {
  return client as unknown as SupabaseClient<TDatabase>;
}

/**
 * PERMANENT: due 抽出 RPC `list_due_ga4_content_evaluations` の戻り値1行。
 *
 * **生成型は `ga4_last_evaluated_on: string` / `ga4_last_seen_content_score: number` と
 * 非 null で出すが、実際は null を返す。** RPC は
 * `supabase/migrations/20260826000300_harden_list_due_ga4_content_evaluations.sql:47-48` で
 * `e.ga4_last_evaluated_on` / `e.ga4_last_seen_content_score` をテーブルから素で select して
 * おり、どちらも nullable 列（`database.types.ts` の `gsc_article_evaluations.Row` も
 * `| null` を持つ）。`supabase gen types` は `returns table(...)` の各列を非 null として
 * 出力するため、この差は migration を適用しても埋まらない。
 *
 * 初回評価前の行（`ga4_last_evaluated_on is null`）は due 判定の主対象なので、
 * 非 null と誤って扱うと未初期化の行で実行時エラーになる。
 */
export type Ga4DueEvaluationRow = {
  id: string;
  user_id: string;
  content_annotation_id: string;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour: number;
  ga4_last_evaluated_on: string | null;
  ga4_last_seen_content_score: number | null;
  /**
   * RPC が算出する「次にGA4評価を行う日」。
   * `coalesce(ga4_last_evaluated_on, base_evaluation_date) + coalesce(cycle_days, 30)` なので
   * こちらは非 null で正しい。
   */
  ga4_next_evaluation_date: string;
};

/**
 * PERMANENT: 上記の戻り値補正を効かせた Database 型。
 *
 * **`Omit` で置換している。** 以前は `Database['public']['Functions'] & { ... }` と交差して
 * いたが、それだと `ga4_last_evaluated_on` が `string & (string | null)` = `string` になり、
 * 補正した null 許容が打ち消されていた（型が付いているように見えて何も守っていない状態）。
 *
 * なお `gsc_article_evaluations` のテーブル列（`ga4_last_evaluated_on` /
 * `ga4_last_seen_content_score` / `ga4_last_notified_history_id`）は
 * `20260826000000_merge_ga4_content_evaluation_into_gsc_cycle.sql` の適用と型再生成で
 * 生成型に入ったため、テーブル側の暫定 override は 2026-09-01 に削除した。
 */
export type Ga4ContentEvaluationScheduleDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], 'list_due_ga4_content_evaluations'> & {
      list_due_ga4_content_evaluations: {
        Args: { p_today_jst: string };
        Returns: Ga4DueEvaluationRow[];
      };
    };
  };
};

/**
 * PROVISIONAL: supabase/migrations/20260904000000_add_content_annotation_summary_jobs.sql
 *
 * AI要約一括のバックグラウンド実行ジョブ（`content_annotation_summary_jobs`）と
 * 排他取得 RPC（`claim_content_annotation_summary_jobs`）の暫定型。
 *
 * 管理者がマイグレーションを適用し `npm run supabase:types` を実行した後、
 * このブロックを削除し、呼び出し側を `Database['public']['Tables']['content_annotation_summary_jobs']`
 * と生成済みの Functions 型へ切り替える（`.agents/skills/supabase/service-usage.md` §6）。
 */
type ContentAnnotationSummaryJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * **`interface` ではなく `type` で書くこと。** supabase-js の `GenericTable` は
 * `Row: Record<string, unknown>` を要求するが、`interface` には暗黙のインデックス
 * シグネチャが付かないため制約を満たせず、`.insert()` の引数型が `never` に落ちる
 * （`.select()` は通るので気づきにくい）。同ファイルの他の暫定型・
 * `supabaseService.ts` の拡張テーブル型も同じ理由で `type` を使っている。
 */
export type ContentAnnotationSummaryJobRow = {
  id: string;
  user_id: string;
  status: ContentAnnotationSummaryJobStatus;
  job_token: string | null;
  target_annotation_ids: string[];
  total_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  failed_by_code: Json;
  attempt_count: number;
  last_error: string | null;
  notified_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type ContentAnnotationSummaryJobInsert = {
  id?: string;
  user_id: string;
  status?: ContentAnnotationSummaryJobStatus;
  job_token?: string | null;
  target_annotation_ids: string[];
  total_count: number;
  processed_count?: number;
  succeeded_count?: number;
  failed_count?: number;
  skipped_count?: number;
  failed_by_code?: Json;
  attempt_count?: number;
  last_error?: string | null;
  notified_at?: string | null;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

type ContentAnnotationSummaryJobUpdate = Partial<ContentAnnotationSummaryJobInsert>;

/**
 * claim RPC が返す1行。`attempt_count` は加算後の値で、
 * 意味は「前進の無い claim が連続した回数」（migration のコメント参照）。
 */
export type ContentAnnotationSummaryClaimedJob = {
  id: string;
  user_id: string;
  target_annotation_ids: string[];
  total_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  skipped_count: number;
  failed_by_code: Json;
  attempt_count: number;
  job_token: string;
};

/**
 * 上記のテーブルと RPC を載せた Database 型。
 * **`Omit` で置換する**（交差にすると補正が無言で潰れる。本ファイル冒頭の注意書き）。
 */
export type ContentAnnotationSummaryJobDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: Database['public']['Tables'] & {
      content_annotation_summary_jobs: {
        Row: ContentAnnotationSummaryJobRow;
        Insert: ContentAnnotationSummaryJobInsert;
        Update: ContentAnnotationSummaryJobUpdate;
        Relationships: [];
      };
    };
    Functions: Database['public']['Functions'] & {
      claim_content_annotation_summary_jobs: {
        Args: { p_limit?: number };
        Returns: ContentAnnotationSummaryClaimedJob[];
      };
    };
  };
};
