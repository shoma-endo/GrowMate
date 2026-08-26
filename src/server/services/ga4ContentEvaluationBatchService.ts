import { SupabaseService } from '@/server/services/supabaseService';
import {
  asPendingClient,
  type Ga4ContentEvaluationScheduleDatabase,
  type Ga4DueEvaluationRow,
} from '@/types/database.types.pending';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';
import { ga4ImportService } from '@/server/services/ga4ImportService';
import { emailService } from '@/server/services/emailService';
import { getGa4EvaluationDateRange } from '@/lib/ga4-evaluation-period';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';
import { buildGa4ConnectionLostEmail, buildGa4ContentEvaluationEmail } from '@/server/lib/ga4-content-evaluation-email';
import {
  classifyGa4BatchRunError,
  classifyGa4BatchRunResult,
  type Ga4ContentEvaluationBatchOutcome,
  type Ga4ContentEvaluationBatchOutcomeResult,
} from '@/server/lib/ga4-content-evaluation-batch-outcome';
import { isGa4ContentEvaluationDue } from '@/server/lib/ga4-content-evaluation-due';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import { env } from '@/env';

// §8.3「時間予算と件数上限」
const BATCH_TIME_LIMIT_MS = 280 * 1000;
const MAX_USERS_PER_BATCH = 10;
const MAX_ARTICLES_PER_BATCH = 20;
const SYNC_TIME_BUDGET_MS = 120 * 1000;
// ライブロック回避（§8.3必須）の強制評価判定専用の締切（レビュー指摘・実装時訂正）。
// 1記事の評価はLLM呼び出しを含み最悪45秒×3試行=135秒かかりうる（§8.1）。route.tsのmaxDuration
// （300秒）に対しこの猶予を残せる時点でなければ強制的に開始してはいけない。BATCH_TIME_LIMIT_MS
// （280秒）をそのまま使うと残り20秒しかなく、開始しても必ずmaxDurationで中断（504）され、
// last_evaluated_onも進まないため次の毎時実行でも同じ状態が繰り返される（真のライブロック）。
const ROUTE_MAX_DURATION_MS = 300 * 1000;
const SINGLE_RUN_WORST_CASE_MS = 135 * 1000; // 45秒 × 3試行（§8.1）
const FORCED_PROGRESS_SAFETY_MARGIN_MS = 10 * 1000;
const FORCED_PROGRESS_DEADLINE_MS =
  ROUTE_MAX_DURATION_MS - SINGLE_RUN_WORST_CASE_MS - FORCED_PROGRESS_SAFETY_MARGIN_MS; // 155秒

/** due抽出RPCが返す1行。スケジュール設定はGSCの評価サイクル行と共有し、進捗だけGA4固有 */
type DueEvaluationRow = Ga4DueEvaluationRow;

type BatchStoppedReason = 'completed' | 'time_limit' | 'max_users' | 'max_articles' | 'no_progress';

interface Ga4ContentEvaluateBatchResult {
  failed: number;
  skippedDueToLimit: number;
  stoppedReason: BatchStoppedReason;
  usersAttempted: number;
  usersProcessed: number;
  articlesEvaluated: number;
  /** articlesEvaluated の内数。軽量パス（baseline_initialized）で成立した件数（GSCのbaselineInitializedと同じ役割）。
   *  history行を作らず通知も送らないため、§3.2の成立率KPI（history集計との突合）で全数評価と区別する目的の観測用カウンタ */
  articlesBaselineInitialized: number;
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

interface DueArticleResult extends Ga4ContentEvaluationBatchOutcomeResult {
  view: Awaited<ReturnType<typeof ga4ContentEvaluationService.run>> | null;
  /** 軽量パス（outcome==='baseline_initialized'）で算出したスコア */
  baselineContentScore?: number | null;
}

/**
 * GA4コンテンツ評価の定期評価バッチ（§8.3）。
 *
 * スケジュール（基準日・サイクル日数・評価実行時間）はGSC検索順位評価と同じ
 * `gsc_article_evaluations` の1行を正とする（2026-08-26にサイクルを1本へ統合）。
 * このサービスは設定を持たず、due な記事を拾って評価・通知するだけを担う。
 *
 * 進捗マーク（`ga4_last_evaluated_on`）だけをGSCと別に持つ理由: gsc-evaluate と
 * ga4-content-evaluate は hourly-cron.yml の matrix で互いをブロックせず起動順が非決定的なので、
 * `last_evaluated_on` を共用すると先に走った方だけが実行され、負けた方はそのサイクルを丸ごと飛ばす。
 */
class Ga4ContentEvaluationBatchService extends SupabaseService {
  private pendingClient() {
    return asPendingClient<Ga4ContentEvaluationScheduleDatabase>(this.getClient());
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

    const { rows: dueRows, truncatedCandidates } = await this.listDueEvaluations(todayJst);
    // truncatedCandidates は1,000行上限（db-max-rows）による取りこぼしなので、
    // 打ち切り監視（validate_count_batch）が読む skippedDueToLimit に合算する（レビュー指摘#4）。

    // next_evaluation_date === today の行だけ evaluation_hour をアプリ側で判定する（§6.6.2）。
    // まだ当日の実行時刻に達していない行は今回の対象から外す（次の毎時実行で再評価する）。
    let articlesSkippedCooldown = 0;
    const dueNow = dueRows.filter(row => {
      const due = isGa4ContentEvaluationDue(
        row.ga4_next_evaluation_date,
        row.evaluation_hour,
        todayJst,
        currentHourJst
      );
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
      articlesBaselineInitialized: 0,
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
    const byUser = new Map<string, DueEvaluationRow[]>();
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

      // 件数上限に既に達している場合、後続ユーザーはどのみち全記事が skippedDueToLimit になる
      // だけなので、ここで打ち切る（レビュー指摘・実装時訂正）。以前は内側ループの continue
      // だけに任せていたため、上限到達後も後続ユーザーの syncUser を呼び続け、同期予算と時間を
      // 浪費していた。
      if (totalArticlesAttempted >= MAX_ARTICLES_PER_BATCH) {
        result.stoppedReason = result.stoppedReason === 'completed' ? 'max_articles' : result.stoppedReason;
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
          const syncResult = await ga4ImportService.syncUser(userId);
          // syncUser は例外だけでなく { ok: false, reason } も正常に返す（レビュー指摘・実装時訂正）。
          // 'already_synced' は直近同期済みで新規取込対象が無いだけの正常系なので除外するが、
          // それ以外（例: 'not_connected'）は取込が実質できていない状態のため syncFailed として扱う。
          // これを見落とすと、GA4未接続のユーザーが古いデータのまま評価され、§6.6.4の
          // 取込失敗時クールダウン抑止（withholdForSyncFailure）が効かなくなる。
          if (!syncResult.ok && syncResult.reason !== 'already_synced') {
            syncFailed = true;
            console.warn('[ga4ContentEvaluationBatchService] syncUser returned failure', {
              userId,
              reason: syncResult.reason,
            });
          }
        } catch (error) {
          syncFailed = true;
          console.error('[ga4ContentEvaluationBatchService] syncUser failed', {
            userId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        syncBudgetRemainingMs -= Date.now() - syncStartedAt;
      }
      if (syncFailed) result.syncFailedUsers += 1;

      let userEmail: string | null | undefined;
      // 取込失敗でスキップした記事（ユーザー単位で1通にまとめて通知する。レビュー🔴6）
      let syncFailureSkipped = 0;
      let syncFailureNextDate: string | null = null;

      for (const cycle of userCycles) {
        if (totalArticlesAttempted >= MAX_ARTICLES_PER_BATCH) {
          result.stoppedReason = result.stoppedReason === 'completed' ? 'max_articles' : result.stoppedReason;
          result.skippedDueToLimit += 1;
          continue;
        }

        const stillNoProgress = result.articlesEvaluated + result.articlesFailed === 0;
        const elapsedNow = Date.now() - startedAt;
        // ライブロック回避（§8.3）: 進捗ゼロの間だけ締切を FORCED_PROGRESS_DEADLINE_MS（155秒）へ
        // 前倒しする。BATCH_TIME_LIMIT_MS（280秒）まで待つと、1記事の最悪所要（135秒）を
        // 確保できないまま強制評価を始めてしまい、必ずmaxDurationで中断される（レビュー指摘・
        // 実装時訂正）。1件でも進捗が出れば以後は通常どおり280秒の締切に戻る。
        const timeLimitForThisArticleMs = stillNoProgress ? FORCED_PROGRESS_DEADLINE_MS : BATCH_TIME_LIMIT_MS;
        if (elapsedNow > timeLimitForThisArticleMs) {
          if (stillNoProgress && !forcedProgressUsed) {
            // 1件も評価していない状態で締切を迎えた場合、先頭の1記事だけは評価を試みてから中断する。
            forcedProgressUsed = true;
          } else {
            result.stoppedReason = 'time_limit';
            result.skippedDueToLimit += 1;
            break userLoop;
          }
        }

        // 取込に失敗している間は評価そのものを実行しない（レビュー🔴6）。
        //
        // 旧実装は抑止条件が `syncFailed && ga4_next_evaluation_date === todayJst` だったため、
        // 予定日を過ぎた記事では抑止が外れ、**古い取込データでスコアを出してスコア付きの
        // 「評価が完了しました」メールを送っていた**。数週間前の残存データで診断が出るうえ、
        // ユーザーには取込が壊れていることが伝わらない。
        //
        // 判定に reason は使わない。`syncUser` が `{ok:false, reason:'not_connected'}` を返すのは
        // `ga4_property_id` が無いときだけで（`ga4ImportService.ts:109-111`）、due抽出RPCが
        // `ga4_property_id is not null` で絞っている以上そこへは実質来ない。実際に起きるのは
        // トークン失効で、それは `ensureAccessToken` が例外を投げて catch 側に落ちる。
        //
        // クールダウンは進める。進めないと毎時同じ記事を掴み続け、通知も毎時になる。
        // 再連携後は記事詳細の「今すぐ評価を実行」で次回予定日を待たずに評価できる。
        if (syncFailed) {
          totalArticlesAttempted += 1;
          result.articlesSkippedSyncFailed += 1;
          syncFailureSkipped += 1;
          syncFailureNextDate = addDaysISO(todayJst, cycle.cycle_days);
          await this.advanceCooldown(cycle.id, cycle.user_id, undefined);
          continue;
        }

        totalArticlesAttempted += 1;
        const articleResult = await this.runDueArticle(cycle);

        if (articleResult.outcome === 'unknown_error' || articleResult.outcome === 'evaluating') {
          result.articlesFailed += 1;
        } else {
          // articlesEvaluated はライブロック回避の進捗判定（noProgressYet/stillNoProgress）にも使う
          // ため、baseline_initialized（軽量パス成功）もここに含める（実際に進捗した実行のため）。
          // 内訳の可観測性はarticlesBaselineInitializedを別途加算して確保する（レビュー指摘。
          // GSCのbaselineInitializedと同じ役割の観測用カウンタ。§8.3可観測性）。
          result.articlesEvaluated += 1;
          if (articleResult.outcome === 'baseline_initialized') {
            result.articlesBaselineInitialized += 1;
          }
        }

        // §6.6.4「取込失敗の扱い」: syncFailed のときは上で continue しているため、
        // ここへ来る時点で取込は成功している（旧 withholdForSyncFailure は不要になった）。
        if (articleResult.shouldAdvanceCooldown) {
          // last_seen_content_score は GSC の last_seen_position と同じ役割（§7.7）で、
          // 登録時のベースラインだけでなく毎回の評価結果で更新し続ける必要がある。
          // 登録時のベースライン取得が失敗した場合、ここで更新しないと状態カードの
          // 「初回計測前」表示が以後の評価が成功しても解消しない（レビュー指摘#1）。
          const freshContentScore =
            articleResult.outcome === 'evaluated' || articleResult.outcome === 'narrative_failed'
              ? (articleResult.view?.history[0]?.contentScore ?? null)
              : articleResult.outcome === 'baseline_initialized'
                ? (articleResult.baselineContentScore ?? null)
                : undefined;
          await this.advanceCooldown(cycle.id, cycle.user_id, freshContentScore);
        }

        if (articleResult.outcome === 'evaluated' || articleResult.outcome === 'narrative_failed') {
          if (articleResult.view) {
            if (userEmail === undefined) {
              userEmail = await this.fetchUserEmail(userId);
            }
            const notification = await this.notifyEvaluationResult({
              cycle,
              userEmail,
              outcome: articleResult.outcome,
              historyId: articleResult.historyId,
              view: articleResult.view,
              // cycle.next_evaluation_date は listDueCycles 時点（advanceCooldown より前）の
              // DB生成列スナップショットで、今回処理した「過去/当日のdue日」のまま。この分岐へ来る
              // ときは必ず shouldAdvance（cooldown進行）も真なので、last_evaluated_on は todayJst に
              // 進んでいる。メール本文は生成列を再取得せず todayJst + cycle_days で正しい次回日を
              // 算出する（高重要度レビュー指摘: 過去/当日の日付がメールに表示される不具合）。
              nextEvaluationDate: addDaysISO(todayJst, cycle.cycle_days),
            });
            if (notification === 'sent') result.emailsSent += 1;
            else if (notification === 'skipped_no_email') result.emailsSkipped += 1;
            else if (notification === 'failed') result.emailsFailed += 1;
          }
        }
      }

      if (syncFailureSkipped > 0 && syncFailureNextDate) {
        if (userEmail === undefined) {
          userEmail = await this.fetchUserEmail(userId);
        }
        const notification = await this.notifyConnectionLost({
          userId,
          userEmail,
          skippedArticleCount: syncFailureSkipped,
          nextEvaluationDate: syncFailureNextDate,
          todayJst,
        });
        if (notification === 'sent') result.emailsSent += 1;
        else if (notification === 'skipped_no_email') result.emailsSkipped += 1;
        else if (notification === 'failed') result.emailsFailed += 1;
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
    byUser: Map<string, DueEvaluationRow[]>,
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
   * due な評価サイクル行を DB から抽出する（§8.3 処理順序1）。
   *
   * 対象は GSC と共有する `gsc_article_evaluations`。due 日は RPC が
   * `coalesce(ga4_last_evaluated_on, base_evaluation_date) + cycle_days` として算出するため、
   * GSC 側の生成列 `next_evaluation_date` とは独立している（GSCバッチが先に走って
   * `last_evaluated_on` を進めても、こちらの due 判定は影響を受けない）。
   *
   * ロール絞り込みはSQL側で行う（RPCが `users.role in ('admin','paid')` を強制するため、
   * 呼び出し側で再確認しない）。GSC側のdue抽出はロールを見ていないが、GSCはLLMを呼ばないため
   * 実害が小さい。GA4はLLMを呼ぶのでこの絞り込みを落としてはいけない。
   *
   * 1,000行上限（db-max-rows）は SupabaseService.fetchAllPaged で回避する。ページングはRPC関数の
   * 引数ではなくPostgRESTの.range()に委ねる: 関数内部でLIMIT/OFFSETを適用すると count:'exact' が
   * 「その呼び出し自体が返した行数」しか返さず、全体件数を反映しないため truncated 判定が
   * 常に false になってしまう（migration のコメント参照）。
   */
  private async listDueEvaluations(
    todayJst: string
  ): Promise<{ rows: DueEvaluationRow[]; truncatedCandidates: number }> {
    const client = this.pendingClient();
    let lastCount: number | null = null;

    const { data, error, truncated } = await this.fetchAllPaged<DueEvaluationRow>(
      async (from, to) => {
        const { data, error, count } = await client
          .rpc('list_due_ga4_content_evaluations', { p_today_jst: todayJst }, { count: 'exact' })
          .range(from, to);
        lastCount = count ?? lastCount;
        return { data, error, count };
      },
      { pageSize: 500 }
    );
    // fetchAllPaged は失敗時に { data: [], error } を返す。error を捨てると due 0件の正常終了と
    // 区別がつかず、RPC未適用・権限不足・DB障害のときに「毎時グリーンで1件も評価しない」状態が
    // 誰にも気づかれないまま続く（validate_count_batch は success と data.failed しか見ない）。
    // ここで throw すれば runBatch が batch_failed を出し、route が 500 を返して監視に乗る。
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`due extraction failed: ${message}`);
    }

    const truncatedCandidates = truncated && lastCount !== null ? Math.max(0, lastCount - data.length) : 0;
    if (truncatedCandidates > 0) {
      console.warn('[ga4ContentEvaluationBatchService] due extraction truncated', { truncatedCandidates });
    }

    return { rows: data, truncatedCandidates };
  }

  /**
   * 1記事の評価を実行し、結末を§8.3「結末の判定契約」の10値へ確定する。
   * displayStatus では判定せず、history[0] の実測で判定する。
   */
  private async runDueArticle(cycle: DueEvaluationRow): Promise<DueArticleResult> {
    // ga4_last_seen_content_score は GSC の last_seen_position 相当（§7.7）。null のときはこの
    // サイクルの初回評価であり、軽量パス（スコア算出のみ・LLMなし・履歴行なし・メールなし）へ
    // 分岐する（gscEvaluationService.processEvaluation の lastSeen===null 分岐と同型。§6.6.2）。
    if (cycle.ga4_last_seen_content_score === null) {
      return this.runBaselinePass(cycle);
    }

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
        console.error('[ga4ContentEvaluationBatchService] unexpected batch run classification', {
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
        console.error('[ga4ContentEvaluationBatchService] unexpected error during batch evaluation', {
          annotationId: cycle.content_annotation_id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return { ...classification, view: null };
    }
  }

  /**
   * 初回パス（ベースラインのみ）。ga4ContentEvaluationService.computeBaselineScore を呼び、
   * 履歴行・LLM診断コメント・通知メールを一切生成しない（GSCのbaseline_initializedと同型）。
   * 結末は既存のGa4ContentEvaluationBatchOutcomeの値（low_data/import_failed）を流用するか、
   * 新設のbaseline_initializedを返す。
   */
  private async runBaselinePass(cycle: DueEvaluationRow): Promise<DueArticleResult> {
    try {
      const { startDate, endDate } = getGa4EvaluationDateRange();
      const result = await ga4ContentEvaluationService.computeBaselineScore({
        userId: cycle.user_id,
        annotationId: cycle.content_annotation_id,
        startDate,
        endDate,
      });
      if (result.status === 'low_data') {
        return { outcome: 'low_data', historyId: null, shouldAdvanceCooldown: true, isUnexpected: false, view: null };
      }
      if (result.status === 'import_failed') {
        return { outcome: 'import_failed', historyId: null, shouldAdvanceCooldown: true, isUnexpected: false, view: null };
      }
      return {
        outcome: 'baseline_initialized',
        historyId: null,
        shouldAdvanceCooldown: true,
        isUnexpected: false,
        view: null,
        baselineContentScore: result.contentScore,
      };
    } catch (error) {
      console.error('[ga4ContentEvaluationBatchService] unexpected error during baseline pass', {
        annotationId: cycle.content_annotation_id,
        message: error instanceof Error ? error.message : String(error),
      });
      return { outcome: 'unknown_error', historyId: null, shouldAdvanceCooldown: true, isUnexpected: true, view: null };
    }
  }

  /**
   * 手動の「今すぐ評価を実行」でGA4評価が成功したときに、GA4側のクールダウンを進める。
   *
   * これを行わない場合、概要タブの「次回評価予定」（GSCの `last_evaluated_on` 起点。手動実行で
   * 進む）とコンテンツ評価タブの「次回評価予定」（`ga4_last_evaluated_on` 起点）が手動実行の
   * たびにズレていく。さらに、手動実行の直後に毎時Cronが同じ記事をdueとして拾い、同じ期間の
   * データでLLMをもう一度呼ぶ二重評価も起きる。
   *
   * サイクル行が無い場合（GSC評価サイクル未登録のままGA4の単発評価だけを回したケース）は
   * 何もしない。失敗しても throw しない: 予定日がズレる不利益より、算出済みの評価結果を
   * ユーザーへ返せなくなる不利益の方が大きいため。
   */
  async advanceCooldownForManualRun(
    userId: string,
    annotationId: string,
    contentScore: number | null
  ): Promise<void> {
    try {
      const { data, error } = await this.pendingClient()
        .from('gsc_article_evaluations')
        .select('id')
        .eq('user_id', userId)
        .eq('content_annotation_id', annotationId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) {
        console.error('[ga4ContentEvaluationBatchService] failed to look up cycle for manual run', {
          annotationId,
          message: error.message,
        });
        return;
      }
      if (!data) return;
      await this.advanceCooldown(data.id, userId, contentScore);
    } catch (error) {
      console.error('[ga4ContentEvaluationBatchService] manual cooldown advance failed', {
        annotationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * GA4側のクールダウンだけを進める。GSCの `last_evaluated_on` には触れない
   * （触ると2ジョブが互いのdue判定を壊す。このファイル冒頭のクラスコメント参照）。
   */
  private async advanceCooldown(
    cycleId: string,
    userId: string,
    contentScore?: number | null
  ): Promise<void> {
    // updated_at は同テーブルの他のwriter（gscEvaluationService / gscDashboard.actions）が
    // 全て明示更新しており、トリガーは存在しない。GA4の前進だけ古いままにしない
    const update: {
      ga4_last_evaluated_on: string;
      updated_at: string;
      ga4_last_seen_content_score?: number | null;
    } = {
      ga4_last_evaluated_on: formatJstDateISO(new Date()),
      updated_at: new Date().toISOString(),
    };
    if (contentScore !== undefined) update.ga4_last_seen_content_score = contentScore;
    // BR-06: due抽出のSELECTだけが例外で、抽出後の書き込みは user_id を明示する
    // （Service Role経由でRLSがバイパスされるため、これが唯一の防御層。GSC側の全writerも同様）
    const { error } = await this.pendingClient()
      .from('gsc_article_evaluations')
      .update(update)
      .eq('id', cycleId)
      .eq('user_id', userId);
    if (error) {
      console.error('[ga4ContentEvaluationBatchService] failed to advance cooldown', {
        cycleId,
        message: error.message,
      });
    }
  }

  private async fetchUserEmail(userId: string): Promise<string | null> {
    const { data, error } = await this.getClient().from('users').select('email').eq('id', userId).maybeSingle();
    if (error) {
      console.error('[ga4ContentEvaluationBatchService] failed to fetch user email', { userId, message: error.message });
      return null;
    }
    return data?.email ?? null;
  }

  /**
   * 評価完了の通知メールを送る（§9.5）。冪等キーは今回の履歴行id。
   * `ga4_last_notified_history_id` と比較して同一なら送らない（BR-12の2段目の防御）。
   * 3段目は emailService が Resend へ渡す idempotencyKey（同じ historyId）。
   *
   * 送信結果の状態列（旧 last_notification_status / _error / _at）は持たない。
   * 唯一の読み手だったコンテンツ評価サイクル設定カードを、サイクル統合にあわせて廃止したため
   * （2026-08-26。表示先の無い状態をDBに溜め続けない）。失敗は console.error と
   * バッチ結果の emailsFailed で観測する。
   */
  /**
   * GA4のデータを取込めず評価できなかったことの通知（レビュー🔴6）。ユーザー単位で1通にまとめる。
   *
   * 冪等キーは userId + 当日（JST）で、Resend 側が同日中の重複送信を弾く。
   * 毎時Cronなので、これが無いと同じ日に最大24通飛ぶ。クールダウンは進めてあるため
   * 通常は1サイクルに1回しか到達しないが、複数の記事の予定日が別々の日に散っている
   * 場合は日ごとに1通になる（その日の評価が実際に失敗しているので妥当）。
   */
  private async notifyConnectionLost(params: {
    userId: string;
    userEmail: string | null;
    skippedArticleCount: number;
    nextEvaluationDate: string;
    todayJst: string;
  }): Promise<'sent' | 'skipped_no_email' | 'failed'> {
    const { userId, userEmail, skippedArticleCount, nextEvaluationDate, todayJst } = params;
    if (!userEmail) {
      console.warn('[ga4ContentEvaluationBatchService] user has no email, skipping connection-lost notification', {
        userId,
      });
      return 'skipped_no_email';
    }

    const content = buildGa4ConnectionLostEmail({
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      skippedArticleCount,
      nextEvaluationDate,
    });
    const response = await emailService.sendGa4ContentEvaluation(
      userEmail,
      content.subject,
      content.html,
      `ga4-connection-lost:${userId}:${todayJst}`
    );
    if (!response.success) {
      console.error('[ga4ContentEvaluationBatchService] connection-lost email failed', {
        userId,
        error: response.error,
        errorName: response.errorName,
      });
      return 'failed';
    }
    return 'sent';
  }

  private async notifyEvaluationResult(params: {
    cycle: DueEvaluationRow;
    userEmail: string | null;
    outcome: Extract<Ga4ContentEvaluationBatchOutcome, 'evaluated' | 'narrative_failed'>;
    historyId: string | null;
    view: Awaited<ReturnType<typeof ga4ContentEvaluationService.run>>;
    /** 呼び出し側で advanceCooldown 後の値として算出した次回評価日（cycle.ga4_next_evaluation_date は
     *  advanceCooldown 前のスナップショットのため使わない） */
    nextEvaluationDate: string;
  }): Promise<'sent' | 'skipped_no_email' | 'failed' | 'skipped_duplicate'> {
    const { cycle, userEmail, outcome, historyId, view, nextEvaluationDate } = params;
    if (!historyId) return 'skipped_duplicate';

    const { data: currentCycle, error: currentCycleError } = await this.pendingClient()
      .from('gsc_article_evaluations')
      .select('ga4_last_notified_history_id')
      .eq('id', cycle.id)
      .eq('user_id', cycle.user_id)
      .maybeSingle();
    if (currentCycleError) {
      console.error('[ga4ContentEvaluationBatchService] failed to read notification state', {
        cycleId: cycle.id,
        message: currentCycleError.message,
      });
    }
    if (currentCycle?.ga4_last_notified_history_id === historyId) {
      return 'skipped_duplicate';
    }

    if (!userEmail) {
      console.warn('[ga4ContentEvaluationBatchService] user has no email, skipping notification', {
        userId: cycle.user_id,
      });
      return 'skipped_no_email';
    }

    const { data: annotation } = await this.getClient()
      .from('content_annotations')
      .select('wp_post_title, canonical_url')
      .eq('id', cycle.content_annotation_id)
      .eq('user_id', cycle.user_id)
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
      nextEvaluationDate,
    });

    const response = await emailService.sendGa4ContentEvaluation(userEmail, content.subject, content.html, historyId);
    if (!response.success) {
      console.error('[ga4ContentEvaluationBatchService] notification email failed', {
        cycleId: cycle.id,
        error: response.error,
        errorName: response.errorName,
      });
      return 'failed';
    }

    await this.pendingClient()
      .from('gsc_article_evaluations')
      .update({ ga4_last_notified_history_id: historyId })
      .eq('id', cycle.id)
      .eq('user_id', cycle.user_id);
    return 'sent';
  }
}

export const ga4ContentEvaluationBatchService = new Ga4ContentEvaluationBatchService();
