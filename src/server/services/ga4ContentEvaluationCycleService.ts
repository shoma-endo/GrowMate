import { SupabaseService } from '@/server/services/supabaseService';
import { asPendingClient, type Ga4ContentEvaluationCycleDatabase } from '@/types/database.types.pending';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import { ga4ImportService } from '@/server/services/ga4ImportService';
import { emailService } from '@/server/services/emailService';
import { getGa4EvaluationDateRange } from '@/lib/ga4-evaluation-period';
import { formatJstDateISO } from '@/lib/date-utils';
import { buildGa4ContentEvaluationEmail } from '@/server/lib/ga4-content-evaluation-email';
import {
  classifyGa4BatchRunError,
  classifyGa4BatchRunResult,
  type Ga4CycleBatchOutcome,
  type Ga4CycleBatchOutcomeResult,
} from '@/server/lib/ga4-content-evaluation-batch-outcome';
import { isGa4CycleDue } from '@/server/lib/ga4-content-evaluation-cycle-due';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { env } from '@/env';
import type {
  Ga4ContentEvaluationCycleRegisterInput,
  Ga4ContentEvaluationCycleUpdateInput,
} from '@/server/schemas/ga4ContentEvaluationCycle.schema';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';

type Ga4ContentEvaluationCycleRow =
  Ga4ContentEvaluationCycleDatabase['public']['Tables']['ga4_content_evaluation_cycles']['Row'];

function toView(row: Ga4ContentEvaluationCycleRow): Ga4ContentEvaluationCycleView {
  return {
    id: row.id,
    baseEvaluationDate: row.base_evaluation_date,
    cycleDays: row.cycle_days,
    evaluationHour: row.evaluation_hour,
    status: row.status,
    lastEvaluatedOn: row.last_evaluated_on,
    lastSeenContentScore: row.last_seen_content_score,
    nextEvaluationDate: row.next_evaluation_date,
    lastNotificationStatus: row.last_notification_status,
    lastNotifiedAt: row.last_notified_at,
  };
}

class ArticleNotFoundError extends Error {
  code = 'article_not_found';
}
class CycleAlreadyRegisteredError extends Error {
  code = 'cycle_already_registered';
}
class CycleNotFoundError extends Error {
  code = 'cycle_not_found';
}

// §8.3「時間予算と件数上限」
const BATCH_TIME_LIMIT_MS = 280 * 1000;
const MAX_USERS_PER_BATCH = 10;
const MAX_ARTICLES_PER_BATCH = 20;
const SYNC_TIME_BUDGET_MS = 120 * 1000;

type DueCycleRow =
  Ga4ContentEvaluationCycleDatabase['public']['Functions']['list_due_ga4_content_evaluation_cycles']['Returns'][number];

type BatchStoppedReason = 'completed' | 'time_limit' | 'max_users' | 'max_articles' | 'no_progress';

interface Ga4ContentEvaluateBatchResult {
  failed: number;
  skippedDueToLimit: number;
  stoppedReason: BatchStoppedReason;
  usersAttempted: number;
  usersProcessed: number;
  articlesEvaluated: number;
  articlesFailed: number;
  articlesSkippedCooldown: number;
  articlesSkippedSyncFailed: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsFailed: number;
  truncatedCandidates: number;
  syncFailedUsers: number;
}

function getJstHour(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return Number(hour);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

interface DueArticleResult extends Ga4CycleBatchOutcomeResult {
  view: Awaited<ReturnType<typeof ga4ContentEvaluationService.run>> | null;
}

class Ga4ContentEvaluationCycleService extends SupabaseService {
  private pendingClient() {
    return asPendingClient<Ga4ContentEvaluationCycleDatabase>(this.getClient());
  }

  async fetchCycle(userId: string, annotationId: string): Promise<Ga4ContentEvaluationCycleView | null> {
    const { data, error } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .select('*')
      .eq('user_id', userId)
      .eq('content_annotation_id', annotationId)
      .maybeSingle();
    if (error) throw error;
    return data ? toView(data) : null;
  }

  async registerCycle(
    userId: string,
    input: Ga4ContentEvaluationCycleRegisterInput
  ): Promise<Ga4ContentEvaluationCycleView> {
    await this.assertOwnedAnnotation(userId, input.annotationId);

    const existing = await this.fetchCycleRow(userId, input.annotationId);
    if (existing) throw new CycleAlreadyRegisteredError('cycle already registered');

    const { data: inserted, error: insertError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .insert({
        user_id: userId,
        content_annotation_id: input.annotationId,
        base_evaluation_date: input.baseEvaluationDate,
        cycle_days: input.cycleDays,
        evaluation_hour: input.evaluationHour,
        status: 'active',
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    // D10: 登録時にベースラインを取得する。通常の評価実行(run())をそのまま呼び、
    // 履歴行も通常どおり作成する(§6.6.2 実装時訂正)。失敗しても登録自体は成立させる
    // (GA4未同期・needs_reauth等は外部要因であり、記事詳細から後で手動評価できる)。
    let baselineScore: number | null = null;
    try {
      const { startDate, endDate } = getGa4EvaluationDateRange();
      const baseline = await ga4ContentEvaluationService.run({
        userId,
        annotationId: input.annotationId,
        startDate,
        endDate,
      });
      baselineScore = baseline.history[0]?.contentScore ?? null;
    } catch (error) {
      console.error('[ga4ContentEvaluationCycleService] baseline evaluation failed', {
        annotationId: input.annotationId,
        code: error instanceof Error ? error.name : 'unknown',
      });
    }

    const { data: updated, error: updateError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update({ last_seen_content_score: baselineScore })
      .eq('id', inserted.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    return toView(updated);
  }

  async updateCycle(
    userId: string,
    input: Ga4ContentEvaluationCycleUpdateInput
  ): Promise<Ga4ContentEvaluationCycleView> {
    await this.assertOwnedAnnotation(userId, input.annotationId);

    const existing = await this.fetchCycleRow(userId, input.annotationId);
    if (!existing) throw new CycleNotFoundError('cycle not found');

    const { data: updated, error: updateError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update({
        base_evaluation_date: input.baseEvaluationDate,
        cycle_days: input.cycleDays,
        evaluation_hour: input.evaluationHour,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (updateError) throw updateError;

    return toView(updated);
  }

  // ===== 定期評価バッチ（§8.3）=====

  async runAllDueEvaluations(): Promise<Ga4ContentEvaluateBatchResult> {
    return CRON_DEFINITIONS.ga4ContentEvaluate.runBatch(startedAt =>
      this.runAllDueEvaluationsWithStartTime(startedAt)
    );
  }

  private async runAllDueEvaluationsWithStartTime(startedAt: number): Promise<Ga4ContentEvaluateBatchResult> {
    const now = new Date();
    const todayJst = formatJstDateISO(now);
    const currentHourJst = getJstHour(now);

    const { rows: dueRows, truncatedCandidates } = await this.listDueCycles(todayJst);
    // truncatedCandidates は1,000行上限（db-max-rows）による取りこぼしなので、
    // 打ち切り監視（validate_count_batch）が読む skippedDueToLimit に合算する（レビュー指摘#4）。

    // next_evaluation_date === today の行だけ evaluation_hour をアプリ側で判定する（§6.6.2）。
    // まだ当日の実行時刻に達していない行は今回の対象から外す（次の毎時実行で再評価する）。
    let articlesSkippedCooldown = 0;
    const dueNow = dueRows.filter(row => {
      const due = isGa4CycleDue(row.next_evaluation_date, row.evaluation_hour, todayJst, currentHourJst);
      if (!due) articlesSkippedCooldown += 1;
      return due;
    });

    const result: Ga4ContentEvaluateBatchResult = {
      failed: 0,
      skippedDueToLimit: 0,
      stoppedReason: 'completed',
      usersAttempted: 0,
      usersProcessed: 0,
      articlesEvaluated: 0,
      articlesFailed: 0,
      articlesSkippedCooldown,
      articlesSkippedSyncFailed: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      emailsFailed: 0,
      truncatedCandidates,
      syncFailedUsers: 0,
    };
    result.skippedDueToLimit += truncatedCandidates;

    if (dueNow.length === 0) {
      CRON_DEFINITIONS.ga4ContentEvaluate.log('info', 'batch_completed', { durationMs: Date.now() - startedAt });
      return result;
    }

    // ユーザー単位にグルーピングし、シャッフルする（特定ユーザーが常に先頭になるのを防ぐ。§8.3 手順3）
    const byUser = new Map<string, DueCycleRow[]>();
    for (const row of dueNow) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }
    const userIds = shuffleInPlace(Array.from(byUser.keys()));

    let syncBudgetRemainingMs = SYNC_TIME_BUDGET_MS;
    let totalArticlesAttempted = 0;
    let forcedProgressUsed = false;

    userLoop: for (const userId of userIds) {
      if (result.usersAttempted >= MAX_USERS_PER_BATCH) {
        result.stoppedReason = 'max_users';
        result.skippedDueToLimit += this.countRemainingArticles(byUser, userIds, result.usersAttempted, 0);
        break;
      }

      const noProgressYet = result.articlesEvaluated + result.articlesFailed === 0;
      const elapsed = Date.now() - startedAt;
      if (elapsed > BATCH_TIME_LIMIT_MS && !(noProgressYet && !forcedProgressUsed)) {
        result.stoppedReason = 'time_limit';
        result.skippedDueToLimit += this.countRemainingArticles(byUser, userIds, result.usersAttempted, 0);
        CRON_DEFINITIONS.ga4ContentEvaluate.log('warn', 'batch_time_budget_exceeded', {
          timeoutType: 'CRON_TIME_BUDGET_EXCEEDED',
          durationMs: elapsed,
        });
        break;
      }

      result.usersAttempted += 1;
      const userCycles = byUser.get(userId) ?? [];

      // 手順4a: ユーザー単位で1回だけ同期する。SYNC_TIME_BUDGET_MSを超えたら以降のユーザーは
      // 同期をスキップし取込済みデータのまま評価へ進む（同期を飛ばしたことはsyncFailedにしない。§8.3）。
      let syncFailed = false;
      if (syncBudgetRemainingMs > 0) {
        const syncStartedAt = Date.now();
        try {
          await ga4ImportService.syncUser(userId);
        } catch (error) {
          syncFailed = true;
          console.error('[ga4ContentEvaluationCycleService] syncUser failed', {
            userId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        syncBudgetRemainingMs -= Date.now() - syncStartedAt;
      }
      if (syncFailed) result.syncFailedUsers += 1;

      let userEmail: string | null | undefined;

      for (const cycle of userCycles) {
        if (totalArticlesAttempted >= MAX_ARTICLES_PER_BATCH) {
          result.stoppedReason = result.stoppedReason === 'completed' ? 'max_articles' : result.stoppedReason;
          result.skippedDueToLimit += 1;
          continue;
        }

        const stillNoProgress = result.articlesEvaluated + result.articlesFailed === 0;
        const elapsedNow = Date.now() - startedAt;
        if (elapsedNow > BATCH_TIME_LIMIT_MS) {
          if (stillNoProgress && !forcedProgressUsed) {
            // ライブロック回避（§8.3）: 1件も評価していない状態で時間切れを迎えた場合、
            // 先頭の1記事だけは評価を試みてから中断する。
            forcedProgressUsed = true;
          } else {
            result.stoppedReason = 'time_limit';
            result.skippedDueToLimit += 1;
            break userLoop;
          }
        }

        totalArticlesAttempted += 1;
        const articleResult = await this.runDueArticle(cycle);

        if (articleResult.outcome === 'unknown_error' || articleResult.outcome === 'evaluating') {
          result.articlesFailed += 1;
        } else {
          result.articlesEvaluated += 1;
        }

        // §6.6.4「取込失敗の扱い」: 当日中のsyncFailedはクールダウンを進めない。
        // next_evaluation_date が過去（当日より前）になってもなお失敗する場合は通常どおり進める。
        const withholdForSyncFailure = syncFailed && cycle.next_evaluation_date === todayJst;
        const shouldAdvance = articleResult.shouldAdvanceCooldown && !withholdForSyncFailure;
        if (shouldAdvance) {
          // last_seen_content_score は GSC の last_seen_position と同じ役割（§7.7）で、
          // 登録時のベースラインだけでなく毎回の評価結果で更新し続ける必要がある。
          // 登録時のベースライン取得が失敗した場合、ここで更新しないと状態カードの
          // 「初回計測前」表示が以後の評価が成功しても解消しない（レビュー指摘#1）。
          const freshContentScore =
            articleResult.outcome === 'evaluated' || articleResult.outcome === 'narrative_failed'
              ? (articleResult.view?.history[0]?.contentScore ?? null)
              : undefined;
          await this.advanceCooldown(cycle.id, freshContentScore);
        }

        if (articleResult.outcome === 'evaluated' || articleResult.outcome === 'narrative_failed') {
          if (withholdForSyncFailure) {
            result.articlesSkippedSyncFailed += 1;
          } else if (articleResult.view) {
            if (userEmail === undefined) {
              userEmail = await this.fetchUserEmail(userId);
            }
            const notification = await this.notifyEvaluationResult({
              cycle,
              userEmail,
              outcome: articleResult.outcome,
              historyId: articleResult.historyId,
              view: articleResult.view,
            });
            if (notification === 'sent') result.emailsSent += 1;
            else if (notification === 'skipped_no_email') result.emailsSkipped += 1;
            else if (notification === 'failed') result.emailsFailed += 1;
          }
        }
      }

      result.usersProcessed += 1;
    }

    // ライブロック回避条件（§8.3必須）: 0件で終わった実行は no_progress として FAIL 扱いにする。
    if (result.usersAttempted > 0 && result.articlesEvaluated + result.articlesFailed === 0) {
      result.stoppedReason = 'no_progress';
      result.articlesFailed += 1;
    }

    result.failed = result.articlesFailed + result.emailsFailed;

    CRON_DEFINITIONS.ga4ContentEvaluate.log('info', 'batch_completed', {
      durationMs: Date.now() - startedAt,
      total: dueNow.length,
      succeeded: result.articlesEvaluated,
      failed: result.failed,
      skipped: result.skippedDueToLimit,
    });

    return result;
  }

  /** シャッフル後の userIds のうち、まだ処理していないユーザーの残記事数を数える（打ち切りログ用）。 */
  private countRemainingArticles(
    byUser: Map<string, DueCycleRow[]>,
    userIds: string[],
    processedUserCount: number,
    processedArticleCountInCurrentUser: number
  ): number {
    let remaining = -processedArticleCountInCurrentUser;
    for (let i = processedUserCount; i < userIds.length; i += 1) {
      remaining += byUser.get(userIds[i]!)?.length ?? 0;
    }
    return Math.max(0, remaining);
  }

  /**
   * due な cycle 行を DB から抽出する（§8.3 処理順序1）。ロール絞り込みはSQL側で行い
   * （多層防御として呼び出し側でも役割を再確認する必要はない。RPCが`users.role in ('admin','paid')`
   * を強制するため）、1,000行上限（db-max-rows）を SupabaseService.fetchAllPaged で回避する。
   */
  private async listDueCycles(
    todayJst: string
  ): Promise<{ rows: DueCycleRow[]; truncatedCandidates: number }> {
    const client = this.pendingClient();
    let lastCount: number | null = null;

    const { data, truncated } = await this.fetchAllPaged<DueCycleRow>(
      async (from, to) => {
        const { data, error, count } = await client.rpc(
          'list_due_ga4_content_evaluation_cycles',
          { p_today_jst: todayJst, p_limit: to - from + 1, p_offset: from },
          { count: 'exact' }
        );
        lastCount = count ?? lastCount;
        return { data, error, count };
      },
      { pageSize: 500 }
    );

    const truncatedCandidates = truncated && lastCount !== null ? Math.max(0, lastCount - data.length) : 0;
    if (truncatedCandidates > 0) {
      console.warn('[ga4ContentEvaluationCycleService] due extraction truncated', { truncatedCandidates });
    }

    return { rows: data, truncatedCandidates };
  }

  /**
   * 1記事の評価を実行し、結末を§8.3「結末の判定契約」の10値へ確定する。
   * displayStatus では判定せず、history[0] の実測で判定する。
   */
  private async runDueArticle(cycle: DueCycleRow): Promise<DueArticleResult> {
    const callStartedAtMs = Date.now();
    try {
      const { startDate, endDate } = getGa4EvaluationDateRange();
      const view = await ga4ContentEvaluationService.run({
        userId: cycle.user_id,
        annotationId: cycle.content_annotation_id,
        startDate,
        endDate,
      });
      const classification = classifyGa4BatchRunResult(view, callStartedAtMs);
      if (classification.isUnexpected) {
        console.error('[ga4ContentEvaluationCycleService] unexpected batch run classification', {
          annotationId: cycle.content_annotation_id,
          outcome: classification.outcome,
          displayStatus: view.displayStatus,
          historyId: classification.historyId,
        });
      }
      return { ...classification, view };
    } catch (error) {
      const classification = classifyGa4BatchRunError(error);
      if (classification.isUnexpected) {
        console.error('[ga4ContentEvaluationCycleService] unexpected error during batch evaluation', {
          annotationId: cycle.content_annotation_id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...classification, view: null };
    }
  }

  private async advanceCooldown(cycleId: string, contentScore?: number | null): Promise<void> {
    const update: { last_evaluated_on: string; last_seen_content_score?: number | null } = {
      last_evaluated_on: formatJstDateISO(new Date()),
    };
    if (contentScore !== undefined) update.last_seen_content_score = contentScore;
    const { error } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update(update)
      .eq('id', cycleId);
    if (error) {
      console.error('[ga4ContentEvaluationCycleService] failed to advance cooldown', {
        cycleId,
        message: error.message,
      });
    }
  }

  private async fetchUserEmail(userId: string): Promise<string | null> {
    const { data, error } = await this.getClient().from('users').select('email').eq('id', userId).maybeSingle();
    if (error) {
      console.error('[ga4ContentEvaluationCycleService] failed to fetch user email', { userId, message: error.message });
      return null;
    }
    return data?.email ?? null;
  }

  /**
   * 評価完了の通知メールを送る（§9.5）。冪等キーは今回の履歴行id。
   * last_notified_history_id と比較して同一なら送らない（BR-12の2段目の防御）。
   */
  private async notifyEvaluationResult(params: {
    cycle: DueCycleRow;
    userEmail: string | null;
    outcome: Extract<Ga4CycleBatchOutcome, 'evaluated' | 'narrative_failed'>;
    historyId: string | null;
    view: Awaited<ReturnType<typeof ga4ContentEvaluationService.run>>;
  }): Promise<'sent' | 'skipped_no_email' | 'failed' | 'skipped_duplicate'> {
    const { cycle, userEmail, outcome, historyId, view } = params;
    if (!historyId) return 'skipped_duplicate';

    const { data: currentCycle, error: currentCycleError } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .select('last_notified_history_id')
      .eq('id', cycle.id)
      .maybeSingle();
    if (currentCycleError) {
      console.error('[ga4ContentEvaluationCycleService] failed to read notification state', {
        cycleId: cycle.id,
        message: currentCycleError.message,
      });
    }
    if (currentCycle?.last_notified_history_id === historyId) {
      return 'skipped_duplicate';
    }

    if (!userEmail) {
      await this.pendingClient()
        .from('ga4_content_evaluation_cycles')
        .update({ last_notification_status: 'skipped_no_email' })
        .eq('id', cycle.id);
      console.warn('[ga4ContentEvaluationCycleService] user has no email, skipping notification', {
        userId: cycle.user_id,
      });
      return 'skipped_no_email';
    }

    const { data: annotation } = await this.getClient()
      .from('content_annotations')
      .select('wp_post_title, canonical_url')
      .eq('id', cycle.content_annotation_id)
      .maybeSingle();

    const latest = view.history[0]!;
    const content = buildGa4ContentEvaluationEmail({
      articleTitle: annotation?.wp_post_title ?? null,
      canonicalUrl: annotation?.canonical_url ?? null,
      annotationId: cycle.content_annotation_id,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      status: outcome,
      contentScore: latest.contentScore ?? 0,
      readScore: latest.readScore ?? 0,
      engageScore: latest.engageScore ?? 0,
      siteRank: latest.siteRank,
      totalArticles: latest.totalArticles,
      narrative: outcome === 'evaluated' && latest.narrative ? latest.narrative : null,
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
      nextEvaluationDate: cycle.next_evaluation_date,
    });

    const response = await emailService.sendGa4ContentEvaluation(userEmail, content.subject, content.html, historyId);
    if (!response.success) {
      console.error('[ga4ContentEvaluationCycleService] notification email failed', {
        cycleId: cycle.id,
        error: response.error,
        errorName: response.errorName,
      });
      await this.pendingClient()
        .from('ga4_content_evaluation_cycles')
        .update({
          last_notification_status: 'failed',
          last_notification_error: (response.errorName ?? response.error ?? 'unknown_error').slice(0, 200),
        })
        .eq('id', cycle.id);
      return 'failed';
    }

    await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .update({
        last_notified_history_id: historyId,
        last_notified_at: new Date().toISOString(),
        last_notification_status: 'sent',
        last_notification_error: null,
      })
      .eq('id', cycle.id);
    return 'sent';
  }

  private async fetchCycleRow(userId: string, annotationId: string) {
    const { data, error } = await this.pendingClient()
      .from('ga4_content_evaluation_cycles')
      .select('id')
      .eq('user_id', userId)
      .eq('content_annotation_id', annotationId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async assertOwnedAnnotation(userId: string, annotationId: string): Promise<void> {
    const { data, error } = await this.getClient()
      .from('content_annotations')
      .select('id')
      .eq('id', annotationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ArticleNotFoundError('article not found');
  }
}

export const ga4ContentEvaluationCycleService = new Ga4ContentEvaluationCycleService();
