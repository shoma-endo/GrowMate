import 'server-only';
import { SupabaseService } from '@/server/services/supabaseService';
import type { Tables } from '@/types/database.types';
import { isInstagramBlogDraftErrorCode, isInstagramBlogDraftStatus } from '@/types/instagram';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { isValidUserRole, type UserRole } from '@/types/user';
import { instagramBlogDraftRunner, InstagramBlogDraftFailure } from '@/server/services/instagramBlogDraftRunner';
import { emailService } from '@/server/services/emailService';
import { buildInstagramBlogDraftEmail } from '@/server/lib/instagram-blog-draft-email';
import {
  hasActiveInstagramBlogDraftJob,
  INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS,
} from '@/server/lib/instagram-blog-draft-jobs';
import { fetchUserEmail } from '@/server/lib/user-email-lookup';
import {
  INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS,
  isInstagramBlogDraftStalled,
} from '@/lib/instagram-blog-draft';

const WORKER_BUDGET_MS = 740_000;
const MAX_PARALLEL_JOBS = 3;
const LOG_TAG = '[Instagram BlogDraft]';

type InstagramBlogDraftJobRow = Tables<'instagram_blog_draft_jobs'>;

type StartInstagramBlogDraftResult = {
  batchId: string | null;
  started: number;
  resumed: number;
  excluded: { created: number; emptyCaption: number; unavailable: number };
};

export class InstagramBlogDraftBatchActiveError extends Error {}

class InstagramBlogDraftJobService extends SupabaseService {
  async start(userId: string, mediaIds: string[]): Promise<StartInstagramBlogDraftResult> {
    const client = this.getClient();
    // 対象外の判定より先に 409 を返すための事前確認。確定の判定は開始の RPC の中でロックを取って行う
    if (await hasActiveInstagramBlogDraftJob(this.getClient(), userId)) throw new InstagramBlogDraftBatchActiveError();

    const { data: media, error: mediaError } = await this.getClient()
      .from('instagram_media')
      .select('id, caption')
      .eq('user_id', userId)
      .in('id', mediaIds);
    if (mediaError) throw new Error('Instagram media lookup failed');
    const mediaById = new Map((media ?? []).map(row => [row.id, row]));
    // instagram_media_id は UNIQUE なので、1投稿につき行は1つ
    const { data: priorJobs, error: jobsError } = await client
      .from('instagram_blog_draft_jobs')
      .select('*')
      .eq('user_id', userId)
      .in('instagram_media_id', mediaIds);
    if (jobsError) throw new Error('Instagram blog draft job lookup failed');
    const priorJobByMedia = new Map((priorJobs ?? []).map(job => [job.instagram_media_id, job]));

    const now = Date.now();
    const selected: Array<{ mediaId: string; prior: InstagramBlogDraftJobRow | null }> = [];
    const excluded = { created: 0, emptyCaption: 0, unavailable: 0 };
    for (const mediaId of mediaIds) {
      const item = mediaById.get(mediaId);
      if (!item) {
        excluded.unavailable += 1;
        continue;
      }
      const prior = priorJobByMedia.get(mediaId) ?? null;
      const stopped = prior !== null && (
        prior.status === 'failed' || (
          isInstagramBlogDraftStatus(prior.status)
          && isInstagramBlogDraftStalled({ status: prior.status, updatedAt: prior.updated_at }, now)
        )
      );
      if (prior && !stopped) {
        excluded.created += 1;
        continue;
      }
      if (!item.caption?.trim()) {
        excluded.emptyCaption += 1;
        continue;
      }
      selected.push({ mediaId, prior });
    }

    if (selected.length === 0) return { batchId: null, started: 0, resumed: 0, excluded };
    const { data: created, error: startError } = await client.rpc('start_instagram_blog_draft_batch', {
      p_user_id: userId,
      p_new_media_ids: selected.flatMap(item => (item.prior ? [] : [item.mediaId])),
      p_resume_job_ids: selected.flatMap(item => (item.prior ? [item.prior.id] : [])),
      p_stale_before: new Date(now - INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS).toISOString(),
    });
    if (startError) throw new Error('Instagram blog draft batch creation failed');
    const batch = created?.[0];
    if (!batch) throw new InstagramBlogDraftBatchActiveError();
    // 同時に別の要求が作成・再開していた投稿
    excluded.created += selected.length - batch.started - batch.resumed;

    // 元のまとまりのメールは付随する処理。失敗しても新しいまとまり（行は付け替え済み）の起動を止めない
    for (const originalBatchId of batch.original_batch_ids) {
      try {
        await this.finalizeBatchIfDone(originalBatchId, userId);
      } catch (error) {
        console.error(`${LOG_TAG} original batch finalize failed`, { batchId: originalBatchId, error });
      }
    }
    return {
      batchId: batch.started + batch.resumed > 0 ? batch.batch_id : null,
      started: batch.started,
      resumed: batch.resumed,
      excluded,
    };
  }

  async runBatch(batchId: string, userId: string, userRole: UserRole): Promise<void> {
    const deadline = Date.now() + WORKER_BUDGET_MS;
    const client = this.getClient();
    const { error: touchError } = await client.from('instagram_blog_draft_jobs')
      .update({ updated_at: new Date().toISOString() })
      .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued');
    if (touchError) throw new Error('Instagram blog draft queue refresh failed');

    const runLane = async (): Promise<void> => {
      while (Date.now() + INSTAGRAM_BLOG_DRAFT_MIN_STEP_REMAINING_MS < deadline) {
        const job = await this.claimNext(batchId, userId);
        if (!job) return;
        await this.runClaimed(job, userId, userRole, deadline);
      }
    };
    await Promise.all(Array.from({ length: MAX_PARALLEL_JOBS }, () => runLane()));
    await this.finalizeBatchIfDone(batchId, userId);
    const { data: queued, error: queuedError } = await client.from('instagram_blog_draft_jobs').select('id')
      .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued').limit(1);
    if (queuedError) throw new Error('Instagram blog draft remaining queue lookup failed');
    if (queued?.length) await this.chain(batchId, userId);
  }

  async authorizeContinuation(batchId: string): Promise<{ userId: string; userRole: UserRole } | null> {
    const client = this.getClient();
    const { data: batch, error } = await client.from('instagram_blog_draft_batches')
      .select('user_id').eq('id', batchId).maybeSingle();
    if (error) throw new Error('Instagram blog draft batch lookup failed');
    if (!batch) return null;
    const userRole = await this.fetchInstagramRole(batch.user_id);
    if (!userRole) {
      const { error: revokeError } = await client.from('instagram_blog_draft_jobs')
        .update({ status: 'failed', error_code: 'ROLE_REVOKED' })
        .eq('batch_id', batchId).eq('user_id', batch.user_id).in('status', ['queued', 'running']);
      if (revokeError) throw new Error('Instagram blog draft role revocation failed');
      await this.finalizeBatchIfDone(batchId, batch.user_id);
      return null;
    }
    return { userId: batch.user_id, userRole };
  }

  private async claimNext(batchId: string, userId: string): Promise<InstagramBlogDraftJobRow | null> {
    const client = this.getClient();
    // 他のレーンに同じ行を先に取られたら、次の候補を取り直す（取られるたびに queued が1行減るので終わる）
    for (;;) {
      const { data: candidate, error } = await client.from('instagram_blog_draft_jobs').select('*')
        .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued')
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (error) throw new Error('Instagram blog draft queue lookup failed');
      if (!candidate) return null;
      const { data: claimed, error: claimError } = await client.from('instagram_blog_draft_jobs')
        .update({ status: 'running' }).eq('id', candidate.id).eq('user_id', userId).eq('status', 'queued')
        .select('*').maybeSingle();
      if (claimError) throw new Error('Instagram blog draft claim failed');
      if (claimed) return claimed;
    }
  }

  private async runClaimed(job: InstagramBlogDraftJobRow, userId: string, role: UserRole, deadline: number): Promise<void> {
    const logContext = { jobId: job.id, batchId: job.batch_id, stage: job.stage };
    try {
      const result = await instagramBlogDraftRunner.run(job.id, userId, role, deadline);
      if (result === 'lost') console.error(`${LOG_TAG} job row lost`, logContext);
    } catch (error) {
      await this.recordJobFailure(job, userId, error instanceof InstagramBlogDraftFailure ? error.code : 'SAVE_FAILED', error);
    }
  }

  private async recordJobFailure(
    job: InstagramBlogDraftJobRow,
    userId: string,
    errorCode: InstagramBlogDraftFailure['code'],
    cause: unknown
  ): Promise<void> {
    const { data: failed, error: failError } = await this.getClient().from('instagram_blog_draft_jobs')
      .update({ status: 'failed', error_code: errorCode })
      .eq('id', job.id).eq('user_id', userId).eq('status', 'running')
      .select('stage, heading_index').maybeSingle();
    // job は取り出した時点の行なので、止まった段階は更新後の行から取る
    const logContext = {
      jobId: job.id,
      batchId: job.batch_id,
      stage: failed?.stage ?? job.stage,
      headingIndex: failed?.heading_index ?? job.heading_index,
    };
    console.error(`${LOG_TAG} job failed`, { ...logContext, errorCode, cause });
    if (failError) {
      console.error(`${LOG_TAG} job failure record failed`, { ...logContext, errorCode, error: failError });
    } else if (!failed) {
      console.error(`${LOG_TAG} job row lost`, logContext);
    }
  }

  private async chain(batchId: string, userId: string): Promise<void> {
    const client = this.getClient();
    const { data: batch, error } = await client.from('instagram_blog_draft_batches').select('chain_count')
      .eq('id', batchId).eq('user_id', userId).maybeSingle();
    if (error || !batch) throw new Error('Instagram blog draft chain lookup failed');
    if (batch.chain_count >= 30) {
      const { error: limitError } = await client.from('instagram_blog_draft_jobs')
        .update({ status: 'failed', error_code: 'CHAIN_LIMIT' })
        .eq('batch_id', batchId).eq('user_id', userId).eq('status', 'queued');
      if (limitError) throw new Error('Instagram blog draft chain limit update failed');
      await this.finalizeBatchIfDone(batchId, userId);
      return;
    }
    const { data: incremented, error: updateError } = await client.from('instagram_blog_draft_batches')
      .update({ chain_count: batch.chain_count + 1 }).eq('id', batchId).eq('user_id', userId)
      .eq('chain_count', batch.chain_count).select('id').maybeSingle();
    if (updateError) throw new Error('Instagram blog draft chain counter update failed');
    if (!incremented) return;
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const secret = process.env.CRON_SECRET;
    if (!baseUrl || !secret) {
      console.error(`${LOG_TAG} continuation fetch failed`, { batchId, error: 'Missing configuration' });
      return;
    }
    try {
      const response = await fetch(new URL('/api/instagram/blog-drafts/continue', baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });
      if (!response.ok) console.error(`${LOG_TAG} continuation fetch failed`, { batchId, status: response.status });
    } catch (error) {
      console.error(`${LOG_TAG} continuation fetch failed`, { batchId, error });
    }
  }

  private async finalizeBatchIfDone(batchId: string, userId: string): Promise<void> {
    const client = this.getClient();
    const { data: jobs, error } = await client.from('instagram_blog_draft_jobs').select('id, status, error_code, session_id, instagram_media_id')
      .eq('batch_id', batchId).eq('user_id', userId);
    if (error) throw new Error('Instagram blog draft completion lookup failed');
    // 行が0件（連携解除で消えた）・ROLE_REVOKED・宛先なしは送らずに notified_at だけ埋める（仕様 BR-008・FR-010）
    if (!jobs?.length) return this.markNotifiedWithoutEmail(batchId, userId);
    if (jobs.some(job => job.status === 'queued' || job.status === 'running')) return;
    if (jobs.some(job => job.error_code === 'ROLE_REVOKED')) return this.markNotifiedWithoutEmail(batchId, userId);
    if (!(await this.fetchInstagramRole(userId))) return this.markNotifiedWithoutEmail(batchId, userId);
    const emailLookup = await fetchUserEmail(this.getClient(), userId, LOG_TAG);
    if (!emailLookup.ok) throw new Error('Instagram blog draft user email lookup failed');
    const emailAddress = emailLookup.email;
    if (!emailAddress) return this.markNotifiedWithoutEmail(batchId, userId);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new Error('Instagram blog draft email URL is not configured');
    const mediaIds = jobs.map(job => job.instagram_media_id);
    const { data: media, error: mediaError } = await this.getClient().from('instagram_media')
      .select('id, caption').eq('user_id', userId).in('id', mediaIds);
    if (mediaError) throw new Error('Instagram blog draft email media lookup failed');
    const sessionIds = jobs.flatMap(job => job.session_id ? [job.session_id] : []);
    const { data: annotations, error: annotationsError } = sessionIds.length === 0
      ? { data: [], error: null }
      : await this.getClient().from('content_annotations')
        .select('session_id, main_kw').eq('user_id', userId).in('session_id', sessionIds);
    if (annotationsError) throw new Error('Instagram blog draft email keyword lookup failed');
    const email = buildInstagramBlogDraftEmail(siteUrl, jobs.map(job => ({
      status: job.status === 'completed' ? 'completed' as const : 'failed' as const,
      errorCode: isInstagramBlogDraftErrorCode(job.error_code) ? job.error_code : null,
      sessionId: job.session_id,
      mainKeyword: annotations?.find(annotation => annotation.session_id === job.session_id)?.main_kw ?? null,
      caption: media?.find(item => item.id === job.instagram_media_id)?.caption ?? '',
    })));
    const { data: claimed, error: claimError } = await client.from('instagram_blog_draft_batches')
      .update({ notified_at: new Date().toISOString() }).eq('id', batchId).eq('user_id', userId).is('notified_at', null)
      .select('id').maybeSingle();
    if (claimError) throw new Error('Instagram blog draft notification claim failed');
    if (!claimed) return;
    const sent = await emailService.sendInstagramBlogDraftNotification(emailAddress, email.subject, email.html,
      batchId);
    if (!sent.success) {
      console.error(`${LOG_TAG} completion email failed`, { batchId, error: sent.error });
    }
  }

  private async markNotifiedWithoutEmail(batchId: string, userId: string): Promise<void> {
    const { error } = await this.getClient().from('instagram_blog_draft_batches')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', batchId).eq('user_id', userId).is('notified_at', null);
    if (error) throw new Error('Instagram blog draft notified_at update failed');
  }

  /** Instagram 連携を使えるロールなら返す。外れていれば null */
  private async fetchInstagramRole(userId: string): Promise<UserRole | null> {
    const { data: user, error } = await this.getClient().from('users')
      .select('role').eq('id', userId).maybeSingle();
    if (error) throw new Error('Instagram blog draft user lookup failed');
    if (!user || !isValidUserRole(user.role) || !canAccessInstagram(user.role)) return null;
    return user.role;
  }
}

export const instagramBlogDraftJobService = new InstagramBlogDraftJobService();
