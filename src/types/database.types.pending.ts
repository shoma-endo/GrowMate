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
