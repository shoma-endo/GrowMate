// PROVISIONAL: supabase/migrations/20260726000000_create_instagram_credentials_table.sql
// 管理者がマイグレーションを適用し `npm run supabase:types` を実行した後、
// この定義を削除し、呼び出し側を `Database['public']['Tables']['instagram_credentials']` へ切り替える。
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export interface InstagramCredentialRow {
  id: string;
  user_id: string;
  ig_user_id: string;
  username: string | null;
  account_type: string | null;
  profile_picture_url: string | null;
  access_token: string;
  access_token_expires_at: string;
  access_token_issued_at: string;
  scope: string[];
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type InstagramOnlyDatabase = {
  __InternalSupabase: Database['__InternalSupabase'];
  public: {
    Tables: {
      instagram_credentials: {
        Row: {
          id: string;
          user_id: string;
          ig_user_id: string;
          username: string | null;
          account_type: string | null;
          profile_picture_url: string | null;
          access_token: string;
          access_token_expires_at: string;
          access_token_issued_at: string;
          scope: string[];
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          ig_user_id: string;
          access_token: string;
          access_token_expires_at: string;
          access_token_issued_at?: string;
          username?: string | null;
          account_type?: string | null;
          profile_picture_url?: string | null;
          scope?: string[];
          last_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
          id?: string;
        };
        Update: {
          ig_user_id?: string;
          username?: string | null;
          account_type?: string | null;
          profile_picture_url?: string | null;
          access_token?: string;
          access_token_expires_at?: string;
          access_token_issued_at?: string;
          scope?: string[];
          last_synced_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type InstagramCredentialInsertRow =
  InstagramOnlyDatabase['public']['Tables']['instagram_credentials']['Insert'];
export type InstagramCredentialUpdateRow =
  InstagramOnlyDatabase['public']['Tables']['instagram_credentials']['Update'];

// PROVISIONAL: supabase/migrations/20260805100000_create_instagram_media_and_account_insights.sql
export interface InstagramMediaRow {
  id: string;
  user_id: string;
  ig_media_id: string;
  media_type: string;
  media_product_type: string;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string;
  posted_at: string;
  like_count: number | null;
  comments_count: number | null;
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
  reposts: number | null;
  reels_skip_rate: number | null;
  avg_watch_time_ms: number | null;
  total_watch_time_ms: number | null;
  insights_synced_at: string | null;
  insights_unavailable: boolean;
  insights_unavailable_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type InstagramMediaInsertRow = Omit<InstagramMediaRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

type InstagramMediaUpdateRow = Partial<
  Omit<InstagramMediaInsertRow, 'user_id' | 'ig_media_id'>
>;

export interface InstagramAccountInsightsDailyRow {
  id: string;
  user_id: string;
  date: string;
  reach: number | null;
  follower_count: number | null;
  imported_at: string;
}

export type InstagramAccountInsightsDailyInsertRow = Omit<
  InstagramAccountInsightsDailyRow,
  'id' | 'imported_at'
> & {
  id?: string;
  imported_at?: string;
};

export type InstagramPhase2Database = {
  __InternalSupabase: Database['__InternalSupabase'];
  public: {
    Tables: InstagramOnlyDatabase['public']['Tables'] & {
      instagram_media: {
        Row: InstagramMediaRow;
        Insert: InstagramMediaInsertRow;
        Update: InstagramMediaUpdateRow;
        Relationships: [];
      };
      instagram_account_insights_daily: {
        Row: InstagramAccountInsightsDailyRow;
        Insert: InstagramAccountInsightsDailyInsertRow;
        Update: Partial<InstagramAccountInsightsDailyInsertRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/**
 * postgrest-js の `upsert()` は `Row extends Relation extends { Insert: unknown } ? Relation['Insert'] : never`
 * という条件型で Row を制約するが、本ファイルの合成 Database 型（`&` で複数テーブルをマージした型）に対しては
 * この条件型が常に `never` に解決される（postgrest-js 側の型解決の制約。`select()` は generic 明示で回避できるが
 * `upsert()` は回避できない）。Pending Migration Types の運用ルールに従い、キャストをこの1関数に閉じる。
 * `asPendingClient` を通した SupabaseClient に対してのみ使うこと（生成済み Database 型には不要）。
 */
export async function upsertPendingRow<TDatabase, Row extends Record<string, unknown>>(
  client: SupabaseClient<TDatabase>,
  table: string,
  values: Row | Row[],
  options: { onConflict: string }
): Promise<{ error: unknown }> {
  const builder = (client as unknown as { from: (table: string) => unknown }).from(table) as {
    upsert: (values: Row | Row[], options: { onConflict: string }) => Promise<{ error: unknown }>;
  };
  return builder.upsert(values, options);
}

/**
 * `update()` も upsertPendingRow と同じ理由（合成 Database 型で条件型が never に解決される）で
 * Row 制約が破綻するため、同じ方針でキャストをこの1関数に閉じる。
 * 本プロジェクトの Instagram 系テーブルは常に user_id + ig_media_id でスコープされる想定。
 */
export async function updateScopedPendingRow<TDatabase, Row extends Record<string, unknown>>(
  client: SupabaseClient<TDatabase>,
  table: string,
  values: Row,
  scope: { userId: string; igMediaId: string }
): Promise<{ error: unknown }> {
  const builder = (client as unknown as { from: (table: string) => unknown }).from(table) as {
    update: (values: Row) => {
      eq: (
        column: string,
        value: string
      ) => { eq: (column: string, value: string) => Promise<{ error: unknown }> };
    };
  };
  return builder.update(values).eq('user_id', scope.userId).eq('ig_media_id', scope.igMediaId);
}

export function asPendingClient<TDatabase>(
  client: SupabaseClient<Database>
): SupabaseClient<TDatabase> {
  return client as unknown as SupabaseClient<TDatabase>;
}
