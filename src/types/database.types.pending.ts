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
