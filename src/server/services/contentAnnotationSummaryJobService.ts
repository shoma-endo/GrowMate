import { env } from '@/env';
import {
  CONTENT_ANNOTATION_BULK_SUMMARY_CONCURRENCY,
  CONTENT_ANNOTATION_SUMMARY_JOB_NOTIFY_MAX_AGE_MS,
  CONTENT_ANNOTATION_SUMMARY_JOB_NOTIFY_MAX_PER_RUN,
} from '@/lib/constants';
import {
  computeSummaryItemBudgetMs,
  isGeneratedSummaryEmpty,
  isSummaryEmpty,
  isWordPressLinkedForSummary,
  SUMMARY_TARGET_FIELD_KEYS,
  type SummaryFailureCode,
  type SummaryTargetFieldKey,
} from '@/server/lib/content-annotation-bulk-summary';
import { buildContentAnnotationSummaryEmail } from '@/server/lib/content-annotation-summary-email';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import {
  contentAnnotationSummaryService,
  type GenerateSummaryResult,
} from '@/server/services/contentAnnotationSummaryService';
import { emailService } from '@/server/services/emailService';
import { SupabaseService } from '@/server/services/supabaseService';
import { canFetchWpPostContentLive } from '@/server/services/wordpressContentSync';
import {
  asPendingClient,
  type ContentAnnotationSummaryClaimedJob,
  type ContentAnnotationSummaryJobDatabase,
  type ContentAnnotationSummaryJobRow,
} from '@/types/database.types.pending';

/**
 * AI要約一括のバックグラウンド実行（ジョブ処理サービス）。
 * 正本: docs/plans/content-annotation-bulk-summary-background-spec.md
 *
 * 起票（`createJob`）・claim（`claimJobs`）・進捗更新（`saveChunkProgress`）・
 * 完了通知（`notifyJob`）は**それぞれ独立したメソッド**にし、対象解決・要約生成・
 * メール本文の組み立てと混ぜない（§4 Non-goals の但し書き。汎用基盤は作らないが、
 * 3例目が出たときの抽出を妨げないため）。
 */

const JOBS_PER_INVOCATION = 1;
const TABLE = 'content_annotation_summary_jobs' as const;
const ACTIVE_STATUSES = ['pending', 'processing'] as const;

/** 対象行の取得に必要な列だけを引く（本文は引かない。取得は単記事コアが行う） */
const TARGET_COLUMNS = ['id', 'wp_post_id', 'canonical_url']
  .concat(SUMMARY_TARGET_FIELD_KEYS)
  .join(', ');

/**
 * 実行直前に取り直す行。**8項目を型に明示すること。**
 * `isSummaryEmpty` が手入力値の上書きを防ぐ唯一のガードで、その入力がこの型だから。
 */
type SummaryTargetRow = {
  id: string;
  wp_post_id: number | null;
  canonical_url: string | null;
} & Record<SummaryTargetFieldKey, string | null>;

type ItemOutcome = GenerateSummaryResult | { success: false; code: 'ITEM_TIME_LIMIT' };

/** 進捗表示（`/analytics`）へ渡す未完了ジョブ */
interface ActiveSummaryJobProgress {
  jobId: string;
  processedCount: number;
  totalCount: number;
}

/**
 * cron ルートのレスポンス（§9「cron ルートのレスポンス形」）。
 *
 * **`failed` に記事単位の失敗を含めない。** `scripts/invoke-cron.sh` の `count-batch` は
 * `data.failed > 0` を job FAIL にするが、本機能は記事単位の失敗が正常系（WordPress の連携が
 * 切れている利用者はジョブ全件が失敗しうる）なので、含めると1件でも失敗した起動がすべて
 * GitHub Actions の赤になり運用通知が慢性的に鳴る。
 * 前例 `ga4ContentEvaluationBatchService.ts` の `failed = articlesFailed + emailsFailed` を
 * そのまま写さないこと（`articlesFailed` の項を外す）。
 *
 * `skipped` / `skippedDueToLimit` / `stoppedReason` は**キーごと載せない**。時間予算での
 * 持ち越しは本仕様の正常系で、載せると毎起動 `::warning::` が出て慢性化する。
 * 持ち越しは `carriedOver`（boolean）で表す。
 */
interface ContentAnnotationSummaryBatchResult {
  failed: number;
  articlesSucceeded: number;
  articlesFailed: number;
  articlesSkipped: number;
  emailsSent: number;
  emailsSkipped: number;
  emailsFailed: number;
  processedJobs: number;
  carriedOver: boolean;
}

interface ChunkTotals {
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  failedByCode: Partial<Record<SummaryFailureCode, number>>;
}

function parseFailedByCode(value: unknown): Partial<Record<SummaryFailureCode, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Partial<Record<SummaryFailureCode, number>> = {};
  for (const [code, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      result[code as SummaryFailureCode] = count;
    }
  }
  return result;
}

/**
 * 1件の要約に上限時間を掛ける。LLM の `timeoutMs` だけでは WordPress 本文取得
 * （タイムアウト無し）を閉じられず、ハングすると `maxDuration` でハードキルされる。
 */
async function runWithItemTimeLimit(
  work: Promise<GenerateSummaryResult>,
  timeLimitMs: number,
  annotationId: string
): Promise<ItemOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<ItemOutcome>(resolve => {
        timer = setTimeout(() => {
          console.error('[content-annotation-summary-job] item time limit reached:', {
            annotationId,
            timeLimitMs,
          });
          resolve({ success: false, code: 'ITEM_TIME_LIMIT' });
        }, timeLimitMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class ContentAnnotationSummaryJobService extends SupabaseService {
  private pendingClient() {
    return asPendingClient<ContentAnnotationSummaryJobDatabase>(this.getClient());
  }

  // ===== 起票・進捗表示（Server Action / サーバーコンポーネントから使う） =====

  /**
   * 未完了（`pending` / `processing`）のジョブを1件返す。BR-B03 の事前検出と
   * BR-B07 の進捗表示の両方で使う。**必ず `user_id` でスコープする**（Service Role 経路）。
   */
  async findActiveJob(userId: string): Promise<ActiveSummaryJobProgress | null> {
    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .select('id, processed_count, total_count')
      .eq('user_id', userId)
      .in('status', [...ACTIVE_STATUSES])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[content-annotation-summary-job] failed to fetch active job:', {
        userId,
        message: error.message,
      });
      return null;
    }
    if (!data) return null;

    return {
      jobId: data.id,
      processedCount: data.processed_count,
      totalCount: data.total_count,
    };
  }

  /**
   * ジョブを1件起票する（BR-B01 / BR-B02）。
   *
   * 二重起票の検出は2段構え。事前 SELECT（`findActiveJob`）で見つからなくても、
   * 同時2クリックは部分ユニークインデックス違反になるため、ここで捕捉して
   * `already_running` を返す。汎用の失敗に落とすと AC-B07 の期待表示と食い違う。
   */
  async createJob(params: {
    userId: string;
    targetAnnotationIds: string[];
  }): Promise<
    | { success: true; jobId: string; totalCount: number }
    | { success: false; reason: 'already_running' | 'failed' }
  > {
    const { userId, targetAnnotationIds } = params;

    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .insert({
        user_id: userId,
        status: 'pending',
        target_annotation_ids: targetAnnotationIds,
        total_count: targetAnnotationIds.length,
      })
      .select('id, total_count')
      .maybeSingle();

    if (error) {
      // 23505 = unique_violation（部分ユニークインデックス。BR-B03 の DB 側担保）
      if (error.code === '23505') {
        return { success: false, reason: 'already_running' };
      }
      console.error('[content-annotation-summary-job] failed to create job:', {
        userId,
        message: error.message,
        code: error.code,
      });
      return { success: false, reason: 'failed' };
    }
    if (!data) {
      return { success: false, reason: 'failed' };
    }

    return { success: true, jobId: data.id, totalCount: data.total_count };
  }

  // ===== cron 本体 =====

  /**
   * @param routeStartedAt cron ルートハンドラの開始時刻。時間予算（BR-B04）の起点。
   *   **claim ではなくルート開始を起点にする**。claim 完了時刻を起点にすると、claim の前に
   *   走る完了メールの掃き出しに要した時間が予算から漏れ、返却バッファを食い潰す。
   */
  async runNextJob(routeStartedAt: number): Promise<ContentAnnotationSummaryBatchResult> {
    return CRON_DEFINITIONS.contentAnnotationSummary.runBatch(() =>
      this.runNextJobWithStartTime(routeStartedAt)
    );
  }

  private async runNextJobWithStartTime(
    routeStartedAt: number
  ): Promise<ContentAnnotationSummaryBatchResult> {
    const result: ContentAnnotationSummaryBatchResult = {
      failed: 0,
      articlesSucceeded: 0,
      articlesFailed: 0,
      articlesSkipped: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      emailsFailed: 0,
      processedJobs: 0,
      carriedOver: false,
    };
    /** ジョブ処理そのものの失敗。記事単位の失敗は絶対に足さない */
    let jobFailures = 0;

    // ---- 1. 未通知ジョブの掃き出し（claim の前に置く）------------------------
    // claim RPC が `attempt_count >= 3` で failed に落とした行はアプリ層が一度も見ないため、
    // ここが無いとその行に完了メールが永久に届かない（AC-B15）
    await this.flushPendingNotifications(result);

    // ---- 2. claim --------------------------------------------------------
    let jobs: ContentAnnotationSummaryClaimedJob[];
    try {
      jobs = await this.claimJobs(JOBS_PER_INVOCATION);
    } catch (error) {
      jobFailures += 1;
      console.error('[content-annotation-summary-job] claim failed:', error);
      CRON_DEFINITIONS.contentAnnotationSummary.log('error', 'job_failed', {
        operation: 'claim',
        durationMs: Date.now() - routeStartedAt,
      });
      result.failed = jobFailures + result.emailsFailed;
      this.logCompleted(result, routeStartedAt);
      return result;
    }

    const job = jobs[0];
    if (!job) {
      result.failed = jobFailures + result.emailsFailed;
      this.logCompleted(result, routeStartedAt);
      return result;
    }

    result.processedJobs = 1;

    // ---- 3. 処理 ---------------------------------------------------------
    try {
      const outcome = await this.processJob(job, routeStartedAt, result);
      if (outcome.progressSaveFailed) jobFailures += 1;
      result.carriedOver = outcome.carriedOver;
    } catch (error) {
      jobFailures += 1;
      console.error('[content-annotation-summary-job] job threw:', { jobId: job.id, error });
      const failedRow = await this.markJobFinished(job, 'failed', {
        lastError: error instanceof Error ? error.message : '想定外のエラー',
      });
      if (failedRow) {
        this.countNotification(await this.notifyJob(failedRow), result);
      }
      result.failed = jobFailures + result.emailsFailed;
      this.logCompleted(result, routeStartedAt);
      return result;
    }

    result.failed = jobFailures + result.emailsFailed;
    this.logCompleted(result, routeStartedAt);
    return result;
  }

  /** claim（排他取得）。ジョブ固有のロジックはここに持ち込まない */
  private async claimJobs(limit: number): Promise<ContentAnnotationSummaryClaimedJob[]> {
    const { data, error } = await this.pendingClient().rpc(
      'claim_content_annotation_summary_jobs',
      { p_limit: limit }
    );
    if (error) {
      throw new Error(error.message || 'AI要約ジョブの取得に失敗しました');
    }
    return data ?? [];
  }

  /**
   * チャンク境界での進捗保存（BR-B09）。
   *
   * - `job_token` を条件に付け、別起動に回収済みのジョブへ書き込まない。
   * - **同じ UPDATE で `attempt_count = 0` を書く。** 本メソッドはチャンクが1つ完走した
   *   ときにしか呼ばれない＝必ず `processed_count` が前進しているため。リセットしないと
   *   前進している正常な継続そのものが試行回数を消費し、4起動目で必ず `failed` になる。
   */
  private async saveChunkProgress(params: {
    jobId: string;
    jobToken: string;
    totals: ChunkTotals;
  }): Promise<boolean> {
    const { jobId, jobToken, totals } = params;
    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .update({
        processed_count: totals.processedCount,
        succeeded_count: totals.succeededCount,
        failed_count: totals.failedCount,
        skipped_count: totals.skippedCount,
        failed_by_code: totals.failedByCode,
        attempt_count: 0,
      })
      .eq('id', jobId)
      .eq('job_token', jobToken)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[content-annotation-summary-job] progress save failed:', {
        jobId,
        message: error.message,
      });
      return false;
    }
    if (!data) {
      console.warn('[content-annotation-summary-job] progress save skipped (stale token):', {
        jobId,
      });
      return false;
    }
    return true;
  }

  /** 状態遷移（`pending` へ戻す / `completed` / `failed`）。`job_token` 条件付き */
  private async markJobFinished(
    job: Pick<ContentAnnotationSummaryClaimedJob, 'id' | 'job_token'>,
    status: 'pending' | 'completed' | 'failed',
    options: { lastError?: string } = {}
  ): Promise<ContentAnnotationSummaryJobRow | null> {
    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .update({
        status,
        ...(status === 'pending' ? {} : { finished_at: new Date().toISOString() }),
        ...(options.lastError === undefined ? {} : { last_error: options.lastError }),
      })
      .eq('id', job.id)
      .eq('job_token', job.job_token)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[content-annotation-summary-job] status update failed:', {
        jobId: job.id,
        status,
        message: error.message,
      });
      return null;
    }
    return data ?? null;
  }

  /**
   * 1ジョブを配列順に3件ずつのチャンクで処理する。
   *
   * - 処理順は `target_annotation_ids` の配列順で固定する（`orderTargetsForProcessing` は使わない）。
   *   `processed_count` が配列 index を指すカーソルなので、並べ替えるとカーソルの意味が壊れる。
   * - **チャンクごとに対象記事を取り直し**、`generateSummary` の直前に BR-B08 を再判定する。
   *   ジョブ全体をループ前に一括取得すると、再判定が最大12分前のスナップショットになる。
   */
  private async processJob(
    job: ContentAnnotationSummaryClaimedJob,
    routeStartedAt: number,
    result: ContentAnnotationSummaryBatchResult
  ): Promise<{ carriedOver: boolean; progressSaveFailed: boolean }> {
    const targets = job.target_annotation_ids;
    const totals: ChunkTotals = {
      processedCount: job.processed_count,
      succeededCount: job.succeeded_count,
      failedCount: job.failed_count,
      skippedCount: job.skipped_count,
      failedByCode: parseFailedByCode(job.failed_by_code),
    };

    // 本文取得の可否判定は**1起動につき1回だけ**（記事ごとに呼ぶと最大1000回になる）。
    // 最初のチャンクに着手する直前に解決する
    let contentFetchAvailable: boolean | null = null;
    let carriedOver = false;

    for (
      let index = totals.processedCount;
      index < targets.length;
      index += CONTENT_ANNOTATION_BULK_SUMMARY_CONCURRENCY
    ) {
      // 着手判定は**戻り値**で行う（経過秒の閾値比較を書かない）。
      // 事後判定にすると、打ち切り直前に着手した1件が最大240秒走って maxDuration を超える
      const budget = computeSummaryItemBudgetMs(Date.now() - routeStartedAt);
      if (budget === null) {
        carriedOver = true;
        CRON_DEFINITIONS.contentAnnotationSummary.log('warn', 'job_time_budget_exceeded', {
          operation: 'summary_generation',
          timeoutType: 'CRON_TIME_BUDGET_EXCEEDED',
          durationMs: Date.now() - routeStartedAt,
          remaining: targets.length - index,
        });
        break;
      }

      if (contentFetchAvailable === null) {
        contentFetchAvailable = await canFetchWpPostContentLive(job.user_id);
      }

      const chunk = targets.slice(index, index + CONTENT_ANNOTATION_BULK_SUMMARY_CONCURRENCY);
      const rows = await this.fetchTargetRows(job.user_id, chunk);
      const rowById = new Map(rows.map(row => [row.id, row]));

      // **前処理の待ち時間を予算に織り込み直す。**上の `budget` は
      // `canFetchWpPostContentLive`（WordPress.com のトークン更新を伴う）と
      // `fetchTargetRows` の**前**に算出した値で、記事タイマーが実際に始まるのは
      // これらの await が終わった後。古い itemMs のまま着手すると、遅延した分だけ
      // 760秒の予算と 800秒の関数上限を踏み越えてハードキルされ、保存済みチャンクの
      // 続きからではなく 20分のスタック回収を待つことになる
      const chunkBudget = computeSummaryItemBudgetMs(Date.now() - routeStartedAt);
      if (chunkBudget === null) {
        carriedOver = true;
        CRON_DEFINITIONS.contentAnnotationSummary.log('warn', 'job_time_budget_exceeded', {
          operation: 'summary_generation',
          timeoutType: 'CRON_TIME_BUDGET_EXCEEDED',
          durationMs: Date.now() - routeStartedAt,
          remaining: targets.length - index,
        });
        break;
      }

      const outcomes = await Promise.all(
        chunk.map(annotationId =>
          this.processAnnotation({
            annotationId,
            row: rowById.get(annotationId),
            userId: job.user_id,
            budget: chunkBudget,
            contentFetchAvailable: contentFetchAvailable === true,
          })
        )
      );

      // チャンクの3件が揃ってから集計とカーソルを進める（BR-B09）
      for (const outcome of outcomes) {
        if (outcome.kind === 'succeeded') {
          totals.succeededCount += 1;
          result.articlesSucceeded += 1;
        } else if (outcome.kind === 'skipped') {
          totals.skippedCount += 1;
          result.articlesSkipped += 1;
        } else {
          totals.failedCount += 1;
          totals.failedByCode[outcome.code] = (totals.failedByCode[outcome.code] ?? 0) + 1;
          result.articlesFailed += 1;
        }
      }
      totals.processedCount = index + chunk.length;

      const saved = await this.saveChunkProgress({
        jobId: job.id,
        jobToken: job.job_token,
        totals,
      });
      if (!saved) {
        // 進捗保存に失敗した時点で以降の処理は保存できない。二重課金を避けるため打ち切る
        return { carriedOver: false, progressSaveFailed: true };
      }
    }

    // **終了状態の保存が成立しなかったら、ジョブ単位の失敗として呼び出し元へ返す。**
    // `markJobFinished` は UPDATE エラーと `job_token` 不一致（＝他の起動に横取りされた）で
    // null を返す。ここを握りつぶすと、処理済みのジョブが `processing` のまま残るのに
    // cron 応答は failed 0 になり、GitHub Actions は緑のまま。利用者には完了が伝わらず、
    // 20分のスタック回収を待つことになる
    if (carriedOver && totals.processedCount < targets.length) {
      const pendingRow = await this.markJobFinished(job, 'pending');
      return { carriedOver: true, progressSaveFailed: pendingRow === null };
    }

    const completedRow = await this.markJobFinished(job, 'completed');
    if (!completedRow) {
      return { carriedOver: false, progressSaveFailed: true };
    }
    this.countNotification(await this.notifyJob(completedRow), result);
    return { carriedOver: false, progressSaveFailed: false };
  }

  /** チャンク（最大3件）の対象記事を取り直す。`user_id` スコープが所有権のガードを兼ねる */
  private async fetchTargetRows(
    userId: string,
    annotationIds: string[]
  ): Promise<SummaryTargetRow[]> {
    const { data, error } = await this.getClient()
      .from('content_annotations')
      .select(TARGET_COLUMNS)
      .eq('user_id', userId)
      .in('id', annotationIds);

    if (error) {
      throw new Error(error.message || '対象記事の取得に失敗しました');
    }
    return (data ?? []) as unknown as SummaryTargetRow[];
  }

  /**
   * 1記事を処理する。`generateSummary` を呼ぶ直前に BR-B08 を再判定する（AC-B13）。
   *
   * 起票から実行まで30〜60分開くため、その間に利用者が8項目を手入力しうる。
   * 単記事コアの `saveSummary` は無条件 UPDATE なので、再判定を落とすと手入力値を
   * 黙って上書きする（履歴が無く復旧できない）。
   */
  private async processAnnotation(params: {
    annotationId: string;
    row: SummaryTargetRow | undefined;
    userId: string;
    budget: { itemMs: number; llmMs: number };
    contentFetchAvailable: boolean;
  }): Promise<
    { kind: 'succeeded' } | { kind: 'skipped' } | { kind: 'failed'; code: SummaryFailureCode }
  > {
    const { annotationId, row, userId, budget, contentFetchAvailable } = params;

    // 取り直しで消えた ID（他人の記事・削除済み）は失敗に計上する（BR-B02 例外）
    if (!row) {
      return { kind: 'failed', code: 'NOT_OWNED' };
    }
    if (!isSummaryEmpty(row) || !isWordPressLinkedForSummary(row)) {
      return { kind: 'skipped' };
    }

    try {
      const generated = await runWithItemTimeLimit(
        contentAnnotationSummaryService.generateSummary({
          target: { annotationId },
          executorUserId: userId,
          // cron にセッションは無い。cookie を持たない getCookie で DB 保存トークン経路だけを使う
          cookieStore: undefined,
          llmTimeoutMs: budget.llmMs,
          // BR-B11。SDK の既定リトライ（429 を寝てから最大2回再送）を止めるのはこの経路だけ
          maxRetries: 0,
        }),
        budget.itemMs,
        annotationId
      );

      if (!generated.success) {
        return {
          kind: 'failed',
          code: this.resolveFailureCode(generated.code, contentFetchAvailable),
        };
      }

      if (isGeneratedSummaryEmpty(generated.fields)) {
        return { kind: 'failed', code: 'EMPTY_SUMMARY' };
      }

      const saved = await contentAnnotationSummaryService.saveSummary({
        annotationId: generated.annotationId,
        userId: generated.userId,
        fields: generated.fields,
      });
      if (!saved.success) {
        return { kind: 'failed', code: 'SAVE_FAILED' };
      }
      return { kind: 'succeeded' };
    } catch (error) {
      console.error('[content-annotation-summary-job] item threw:', { annotationId, error });
      return { kind: 'failed', code: 'UNEXPECTED' };
    }
  }

  /**
   * 本文取得の可否判定が「不可」だった起動の本文取得失敗を `SUMMARY_WP_REAUTH_REQUIRED` へ
   * 読み替える（BR-B10）。既存ラベルは「連携先と違うサイトの記事か、記事が削除・非公開」と
   * 原因を断定しており、連携が切れている利用者に誤った次アクションを案内するため。
   *
   * 読み替えはここ（集計時）だけで行い、単記事コアの `generateSummary` は変更しない。
   */
  private resolveFailureCode(
    code: SummaryFailureCode,
    contentFetchAvailable: boolean
  ): SummaryFailureCode {
    if (code === 'SUMMARY_CONTENT_FETCH_FAILED' && !contentFetchAvailable) {
      return 'SUMMARY_WP_REAUTH_REQUIRED';
    }
    return code;
  }

  // ===== 完了通知 =====

  /**
   * 未通知で終了済みのジョブを掃き出す（§9「完了メールの起動経路」経路2）。
   *
   * Service Role で全利用者のジョブを横断して取得するが（未通知の行がどの利用者のものか
   * 事前に分からないため）、**宛先と本文は取得した各行の `user_id` から解決し、
   * 行をまたいだ結合はしない**。これが §6 権限の `user_id` 明示スコープの唯一の例外。
   *
   * 対象は `created_at` が24時間以内の行に限る。Resend の `Idempotency-Key` は24時間で失効し、
   * それを過ぎた再送はどのみち重複を防げない。窓が無いと恒久的な送信失敗の行が滞留し、
   * 10件の枠を占有して他のジョブの通知が届かなくなる。
   */
  private async flushPendingNotifications(
    result: ContentAnnotationSummaryBatchResult
  ): Promise<void> {
    const cutoff = new Date(
      Date.now() - CONTENT_ANNOTATION_SUMMARY_JOB_NOTIFY_MAX_AGE_MS
    ).toISOString();

    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .select('*')
      .in('status', ['completed', 'failed'])
      .is('notified_at', null)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(CONTENT_ANNOTATION_SUMMARY_JOB_NOTIFY_MAX_PER_RUN);

    if (error) {
      console.error('[content-annotation-summary-job] notification sweep failed:', error.message);
      result.emailsFailed += 1;
      return;
    }

    // 逐次送信。Resend の既定レート上限は 10 requests/second/team なので、
    // 10件を逐次で送る限り上限には触れない
    for (const row of data ?? []) {
      this.countNotification(await this.notifyJob(row), result);
    }
  }

  private countNotification(
    outcome: 'sent' | 'skipped_no_email' | 'failed' | 'already_notified',
    result: ContentAnnotationSummaryBatchResult
  ): void {
    if (outcome === 'sent') result.emailsSent += 1;
    else if (outcome === 'skipped_no_email') result.emailsSkipped += 1;
    else if (outcome === 'failed') result.emailsFailed += 1;
  }

  /**
   * 終了したジョブに完了メールを1通送る（BR-B06）。
   *
   * **`notified_at` を打つのは「通知の試行を終えたとき」**で、送信成功時に加えて
   * **宛先が無いと確認できた**ときも打つ。打たないと `notified_at is null` のまま毎起動の
   * 掃き出しに選ばれ続け、10件の枠を古い滞留行が永久に占有する（AC-B15 の経路が死ぬ）。
   * **送信失敗と宛先の取得失敗のときは打たず**、次回の掃き出しで再試行する。
   *
   * 宛先の取得失敗を「宛先が無い」と同じ扱いにしてはならない。`users` の SELECT が
   * 一時的に落ちただけで `notified_at` を打つと、その行は二度と掃き出しに選ばれず、
   * **画面を閉じた利用者へ完了結果が永久に届かない**。取得エラーは `failed` に倒し、
   * 次回起動で取り直す（掃き出しの母集団は `created_at` 24時間以内なので再試行は有限）。
   */
  private async notifyJob(
    job: ContentAnnotationSummaryJobRow
  ): Promise<'sent' | 'skipped_no_email' | 'failed' | 'already_notified'> {
    if (job.notified_at) return 'already_notified';
    if (job.status !== 'completed' && job.status !== 'failed') return 'already_notified';

    const emailLookup = await this.fetchUserEmail(job.user_id);
    if (!emailLookup.ok) {
      // 取得エラーは「宛先が無い」と区別する。ここで notified_at を打つと掃き出しの
      // 母集団から外れ、一時的な DB エラー1回で完了通知が永久に失われる
      await this.recordNotificationFailure(job.id, 'user_email_lookup_failed');
      return 'failed';
    }
    const userEmail = emailLookup.email;
    if (!userEmail) {
      console.warn('[content-annotation-summary-job] user has no email, skipping notification:', {
        jobId: job.id,
      });
      await this.markNotified(job.id);
      return 'skipped_no_email';
    }

    const content = buildContentAnnotationSummaryEmail({
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      status: job.status,
      totalCount: job.total_count,
      succeededCount: job.succeeded_count,
      failedCount: job.failed_count,
      skippedCount: job.skipped_count,
      unprocessedCount: Math.max(0, job.total_count - job.processed_count),
      failedByCode: parseFailedByCode(job.failed_by_code),
    });

    // 冪等キーはジョブ ID。送信成功後・notified_at 更新前のハードキル窓を塞ぐのはこれだけ
    const response = await emailService.sendContentAnnotationSummaryCompletion(
      userEmail,
      content.subject,
      content.html,
      job.id
    );

    if (!response.success) {
      console.error('[content-annotation-summary-job] completion email failed:', {
        jobId: job.id,
        error: response.error,
        errorName: response.errorName,
      });
      await this.recordNotificationFailure(job.id, response.error);
      return 'failed';
    }

    await this.markNotified(job.id);
    return 'sent';
  }

  /**
   * 宛先メールを取り出す。**「行が無い / 空」と「取得できなかった」を別の結果で返す**。
   * 呼び出し側が前者を `notified_at` 打ち、後者を再試行に倒せるようにするため。
   */
  private async fetchUserEmail(
    userId: string
  ): Promise<{ ok: true; email: string | null } | { ok: false }> {
    const { data, error } = await this.getClient()
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('[content-annotation-summary-job] failed to fetch user email:', {
        userId,
        message: error.message,
      });
      return { ok: false };
    }
    const email = data?.email?.trim();
    return { ok: true, email: email ? email : null };
  }

  private async markNotified(jobId: string): Promise<void> {
    const { error } = await this.pendingClient()
      .from(TABLE)
      .update({ notified_at: new Date().toISOString() })
      .eq('id', jobId)
      .is('notified_at', null);
    if (error) {
      console.error('[content-annotation-summary-job] failed to mark notified:', {
        jobId,
        message: error.message,
      });
    }
  }

  private async recordNotificationFailure(jobId: string, reason?: string): Promise<void> {
    const { error } = await this.pendingClient()
      .from(TABLE)
      .update({ last_error: `completion_email_failed: ${reason ?? 'unknown'}` })
      .eq('id', jobId);
    if (error) {
      console.error('[content-annotation-summary-job] failed to record email failure:', {
        jobId,
        message: error.message,
      });
    }
  }

  private logCompleted(result: ContentAnnotationSummaryBatchResult, routeStartedAt: number): void {
    CRON_DEFINITIONS.contentAnnotationSummary.log('info', 'batch_completed', {
      durationMs: Date.now() - routeStartedAt,
      total: result.processedJobs,
      succeeded: result.articlesSucceeded,
      failed: result.failed,
    });
  }
}

export const contentAnnotationSummaryJobService = new ContentAnnotationSummaryJobService();
