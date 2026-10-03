import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS } from '@/lib/instagram-blog-draft';
import type { Database } from '@/types/database.types';
import type { InstagramBlogDraftBatchProgress } from '@/types/instagram';

/**
 * 次のステップ（または見出し・続きの生成）に着手するのに要る残り時間。
 * AI 呼び出しのタイムアウト 180 秒 + 保存の余裕 20 秒（仕様 FR-006）。
 * ワーカーの取り出しと Runner の着手の判定が同じ値である必要がある
 */
export const INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS = 200_000;

/** 止まっていない待機中・作成中の行を1件返す。無ければ null */
async function findActiveInstagramBlogDraftJob(
  client: SupabaseClient<Database>,
  userId: string
): Promise<{ batch_id: string } | null> {
  const cutoff = new Date(Date.now() - INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS).toISOString();
  const { data, error } = await client
    .from('instagram_blog_draft_jobs')
    .select('batch_id')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .gte('updated_at', cutoff)
    .limit(1);
  if (error) throw new Error('Instagram blog draft active job lookup failed');
  return data?.[0] ?? null;
}

/** 止まっていない待機中・作成中の行があるか（開始の 409 の事前確認） */
export async function hasActiveInstagramBlogDraftJob(
  client: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  return (await findActiveInstagramBlogDraftJob(client, userId)) !== null;
}

/** 作成中のまとまりの進み具合。作成中・待機中の行が無ければ null */
export async function getActiveInstagramBlogDraftProgress(
  client: SupabaseClient<Database>,
  userId: string
): Promise<InstagramBlogDraftBatchProgress | null> {
  const active = await findActiveInstagramBlogDraftJob(client, userId);
  if (!active) return null;
  const { data, error } = await client
    .from('instagram_blog_draft_jobs')
    .select('status')
    .eq('user_id', userId)
    .eq('batch_id', active.batch_id);
  if (error) throw new Error('Instagram blog draft batch progress lookup failed');
  const jobs = data ?? [];
  return {
    processed: jobs.filter(job => job.status === 'completed' || job.status === 'failed').length,
    total: jobs.length,
  };
}
