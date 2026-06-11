import { SupabaseService } from '@/server/services/supabaseService';
import { gscSuggestionService } from '@/server/services/gscSuggestionService';
import type { GscSuggestionJobBatchResult, GscSuggestionJobRow } from '@/types/gsc';

const RETRY_DELAY_MINUTES = 15;
const JOBS_PER_INVOCATION = 2;
const JOB_TIMEOUT_MS = 240 * 1000;

class GscSuggestionJobService {
  private readonly supabaseService = new SupabaseService();

  async runNextJobs(): Promise<GscSuggestionJobBatchResult> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('claim_gsc_suggestion_jobs', { p_limit: JOBS_PER_INVOCATION });

    if (error) {
      throw new Error(error.message || 'GSC提案ジョブの取得に失敗しました');
    }

    const jobs = (data ?? []) as GscSuggestionJobRow[];
    if (jobs.length === 0) {
      return { total: 0, completed: 0, failed: 0, terminalFailed: 0 };
    }

    const results = await Promise.all(jobs.map(job => this.processJob(job)));
    const completed = results.filter(result => result === 'completed').length;
    return {
      total: jobs.length,
      completed,
      failed: results.filter(result => result === 'retrying' || result === 'terminal_failed').length,
      terminalFailed: results.filter(result => result === 'terminal_failed').length,
    };
  }

  private async processJob(
    job: GscSuggestionJobRow
  ): Promise<'completed' | 'retrying' | 'terminal_failed' | 'discarded'> {
    const controller = new AbortController();
    try {
      await this.withTimeout(
        () =>
          gscSuggestionService.generate({
            userId: job.user_id,
            contentAnnotationId: job.content_annotation_id,
            evaluationHistoryId: job.id,
            outcome: job.outcome,
            currentPosition: this.toNumberOrNull(job.current_position),
            previousPosition: this.toNumberOrNull(job.previous_position),
            currentSuggestionStage: job.suggestion_stage,
            jobToken: job.suggestion_job_token,
            signal: controller.signal,
          }),
        controller
      );

      const { data, error: updateError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluation_history')
        .update({
          suggestion_status: 'completed',
          suggestion_completed_at: new Date().toISOString(),
          suggestion_error: null,
          suggestion_next_retry_at: null,
        })
        .eq('id', job.id)
        .eq('user_id', job.user_id)
        .eq('suggestion_status', 'processing')
        .eq('suggestion_job_token', job.suggestion_job_token)
        .not('suggestion_summary', 'is', null)
        .select('id')
        .maybeSingle();

      if (updateError) {
        throw new Error(updateError.message || 'GSC提案ジョブの完了更新に失敗しました');
      }
      if (!data) {
        throw new Error('GSC提案ジョブの完了条件を満たしていません');
      }

      return 'completed';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GSC改善提案の生成に失敗しました';
      const nextRetryAt = new Date(Date.now() + RETRY_DELAY_MINUTES * 60 * 1000).toISOString();
      const { data, error: updateError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluation_history')
        .update({
          suggestion_status: 'failed',
          suggestion_error: message,
          suggestion_next_retry_at: nextRetryAt,
        })
        .eq('id', job.id)
        .eq('user_id', job.user_id)
        .eq('suggestion_status', 'processing')
        .eq('suggestion_job_token', job.suggestion_job_token)
        .select('id')
        .maybeSingle();

      if (updateError) {
        console.error('[GscSuggestionJobService] Failed to mark job failure:', updateError);
        return 'retrying';
      }
      if (!data) {
        console.warn(`[GscSuggestionJobService] Discarded stale job result: ${job.id}`);
        return 'discarded';
      }

      console.error(`[GscSuggestionJobService] Job ${job.id} failed:`, error);
      return job.suggestion_attempt_count >= 3 ? 'terminal_failed' : 'retrying';
    }
  }

  private toNumberOrNull(value: number | string | null): number | null {
    if (value === null) {
      return null;
    }
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private async withTimeout(task: () => Promise<void>, controller: AbortController): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error('GSC改善提案の生成がタイムアウトしました');
        controller.abort(error);
        reject(error);
      }, JOB_TIMEOUT_MS);
    });

    await Promise.race([task(), timeout]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }
}

export const gscSuggestionJobService = new GscSuggestionJobService();
