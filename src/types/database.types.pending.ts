import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

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
