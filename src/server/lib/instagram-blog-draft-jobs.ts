import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS } from '@/lib/instagram-blog-draft';
import type { Database } from '@/types/database.types';

/**
 * 次のステップ（または見出し・続きの生成）に着手するのに要る残り時間。
 * AI 呼び出しのタイムアウト 180 秒 + 保存の余裕 20 秒（仕様 FR-006）。
 * ワーカーの取り出しと Runner の着手の判定が同じ値である必要がある
 */
export const INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS = 200_000;

/** 止まっていない待機中・作成中の行があるか。開始の 409 と画面の［ブログ記事を作成］の可否で共用する */
export async function hasActiveInstagramBlogDraftJob(
  client: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS).toISOString();
  const { data, error } = await client
    .from('instagram_blog_draft_jobs')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .gte('updated_at', cutoff)
    .limit(1);
  if (error) throw new Error('Instagram blog draft active job lookup failed');
  return (data?.length ?? 0) > 0;
}
