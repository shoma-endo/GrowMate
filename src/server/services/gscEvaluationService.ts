import { SupabaseService } from '@/server/services/supabaseService';
import type {
  GscEvaluationOutcome,
  GscPageMetric,
  EvaluationResultSummary,
  BatchResultSummary,
  GscEvaluationRow,
  RunEvaluationOptions,
} from '@/types/gsc';
import { gscSuggestionService } from '@/server/services/gscSuggestionService';
import { gscImportService } from '@/server/services/gscImportService';
import { formatDateISO, addDaysISO } from '@/lib/date-utils';

export class GscEvaluationService {
  private readonly supabaseService = new SupabaseService();

  // バッチ処理の制限定数
  private static readonly BATCH_TIME_LIMIT_MS = 280 * 1000; // 280秒（maxDuration 300秒より20秒短く余裕を持たせる）
  private static readonly MAX_USERS_PER_BATCH = 10;
  private static readonly EVALUATION_CONCURRENCY = 3;

  async runDueEvaluationsForUser(
    userId: string,
    options: RunEvaluationOptions = {}
  ): Promise<EvaluationResultSummary> {
    const { force = false, contentAnnotationId, evaluations, nowJst, startTime } = options;
    const currentJst = nowJst ?? this.getNowJst();
    const todayJst = formatDateISO(currentJst);
    const currentHourJst = currentJst.getHours();

    const summary: EvaluationResultSummary = {
      processed: 0,
      improved: 0,
      advanced: 0,
      skippedNoMetrics: 0,
      skippedImportFailed: 0,
      skippedSystemError: 0,
    };

    // 取得済みがあればそれを利用。なければDBからフェッチ
    let allEvaluations: GscEvaluationRow[];
    if (evaluations) {
      allEvaluations = contentAnnotationId
        ? evaluations.filter(e => e.content_annotation_id === contentAnnotationId)
        : evaluations;
    } else {
      const { data: fetchedEvaluations, error: evalError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluations')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .match(contentAnnotationId ? { content_annotation_id: contentAnnotationId } : {});

      if (evalError) {
        throw new Error(evalError.message || '評価対象の取得に失敗しました');
      }

      allEvaluations = (fetchedEvaluations || []) as GscEvaluationRow[];
    }

    // force: true の場合はフィルタリングをスキップ（手動実行用）
    // それ以外は評価期限が来ているものをフィルタリング
    const evaluationRows = force
      ? allEvaluations
      : allEvaluations.filter(evaluation => this.isDue(evaluation, todayJst, currentHourJst));

    if (evaluationRows.length === 0) {
      return summary;
    }

    // --- 効率化のキモ: ユーザー単位での一括インポート ---
    let bulkImportFailed = false;
    let batchHitLimit = false;

    try {
      const maxCycleDays = Math.max(...evaluationRows.map(e => e.cycle_days || 30));
      const startDate = addDaysISO(todayJst, -maxCycleDays);

      const importResult = await gscImportService.importMetrics(userId, {
        startDate,
        endDate: todayJst,
        searchType: 'web',
        maxRows: 5000,
      });
      batchHitLimit = importResult.pageMetricsHitLimit;
      console.log(
        `[gscEvaluationService] Pre-imported ${maxCycleDays} days of data for user ${userId} (${evaluationRows.length} articles). Hit limit: ${batchHitLimit}`
      );
    } catch (importError) {
      console.warn(
        `[gscEvaluationService] Failed to pre-import data for user ${userId}. Proceeding article-by-article.`,
        importError
      );
      bulkImportFailed = true;
    }

    // ------------------------------------------------

    // 記事評価をチャンク単位で並列実行
    // 完全な直列よりスループットを上げつつ、同時LLM呼び出し数を制御（並列数: 3）
    const CONCURRENCY = GscEvaluationService.EVALUATION_CONCURRENCY;
    for (let i = 0; i < evaluationRows.length; i += CONCURRENCY) {
      // 制限時間のチェック（チャンクごと）
      if (startTime) {
        const elapsed = Date.now() - startTime;
        if (elapsed > GscEvaluationService.BATCH_TIME_LIMIT_MS) {
          console.warn(
            `[gscEvaluationService] Time limit reached during user ${userId} articles (${elapsed}ms). Interrupting at chunk ${i / CONCURRENCY}.`
          );
          break;
        }
      }

      const chunk = evaluationRows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async evaluation => {
          try {
            return await this.processEvaluation(
              userId,
              evaluation,
              todayJst,
              batchHitLimit,
              bulkImportFailed
            );
          } catch (error) {
            console.error('[gscEvaluationService] System error during evaluation:', error);
            void this.logSystemError(userId, evaluation.content_annotation_id, todayJst, error);
            return { status: 'system_error' as const };
          }
        })
      );

      // チャンクの結果を集計
      for (const evalResult of results) {
        if (evalResult.status === 'skipped_no_metrics') {
          summary.skippedNoMetrics += 1;
        } else if (evalResult.status === 'skipped_import_failed') {
          summary.skippedImportFailed += 1;
        } else if (evalResult.status === 'success') {
          summary.processed += 1;
          if (evalResult.outcome === 'improved') {
            summary.improved += 1;
          } else {
            summary.advanced += 1;
          }
        } else if (evalResult.status === 'system_error') {
          summary.skippedSystemError += 1;
        }
      }
    }

    return summary;
  }

  /**
   * システムエラーを履歴に記録（並行・待機しない）
   */
  private async logSystemError(
    userId: string,
    contentAnnotationId: string,
    evaluationDate: string,
    error: unknown
  ): Promise<void> {
    try {
      const { error: insertError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluation_history')
        .insert({
          user_id: userId,
          content_annotation_id: contentAnnotationId,
          evaluation_date: evaluationDate,
          outcome_type: 'error',
          error_code: 'system_error',
          error_message: error instanceof Error ? error.message : 'システムエラーが発生しました',
          suggestion_applied: false,
          created_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('[gscEvaluationService] Failed to save system error history:', insertError);
      }
    } catch (err) {
      console.error('[gscEvaluationService] Unexpected error saving system error history:', err);
    }
  }

  /**
   * 単一の評価を処理（並列実行用）
   */
  private async processEvaluation(
    userId: string,
    evaluation: GscEvaluationRow,
    today: string,
    batchHitLimit: boolean = false,
    bulkImportFailed: boolean = false
  ): Promise<
    | { status: 'success'; outcome: GscEvaluationOutcome }
    | { status: 'skipped_import_failed' }
    | { status: 'skipped_no_metrics' }
  > {
    // 1. 最新メトリクスの取得試行
    let metric = await this.fetchLatestMetric(userId, evaluation);

    // 2. メトリクスが見つからず、かつバッチ上限に達していた場合はフォールバック
    if (!metric && batchHitLimit) {
      console.log(
        `[gscEvaluationService] Metric missing and batch limit hit. Fetching targeted data for: ${evaluation.id}`
      );
      const cycleDays = evaluation.cycle_days || 30;
      const startDate = addDaysISO(today, -cycleDays);

      try {
        const { data: annotation } = await this.supabaseService
          .getClient()
          .from('content_annotations')
          .select('canonical_url')
          .eq('id', evaluation.content_annotation_id)
          .maybeSingle();

        if (annotation?.canonical_url) {
          await gscImportService.importPageAndQueryForUrlWithSplit(userId, {
            startDate,
            endDate: today,
            pageUrl: annotation.canonical_url,
            contentAnnotationId: evaluation.content_annotation_id,
            searchType: 'web',
            segmentDays: cycleDays,
          });
          // 再フェッチ
          metric = await this.fetchLatestMetric(userId, evaluation);
        }
      } catch (err) {
        console.error(`[gscEvaluationService] Fallback import failed for ${evaluation.id}:`, err);
      }
    }

    // 3. 最終的なメトリクスチェック
    if (!metric) {
      const nextRetryDate = addDaysISO(today, evaluation.cycle_days || 30);
      // インポート一括失敗フラグが立っている場合は import_failed、そうでなければ no_metrics
      const errorCode = bulkImportFailed ? 'import_failed' : 'no_metrics';
      const errorMessage = bulkImportFailed
        ? 'Google Search Consoleのデータ一括取得に失敗したため、最新の指標を取得できませんでした。'
        : `この記事のメトリクスデータが見つかりませんでした。Google Search Consoleに記事が表示されているか確認してください。（次回再試行予定日: ${nextRetryDate}）`;

      const { error: historyError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluation_history')
        .insert({
          user_id: userId,
          content_annotation_id: evaluation.content_annotation_id,
          evaluation_date: today,
          outcome_type: 'error',
          error_code: errorCode,
          error_message: errorMessage,
          suggestion_applied: false,
          created_at: new Date().toISOString(),
        });

      if (historyError) {
        console.error(
          `[gscEvaluationService] Failed to save error history for ${evaluation.id}:`,
          historyError
        );
      }

      if (!bulkImportFailed) {
        await this.updateCooldown(evaluation.id, userId, today);
      }

      return { status: bulkImportFailed ? 'skipped_import_failed' : 'skipped_no_metrics' };
    }

    const lastSeen = this.toNumberOrNull(evaluation.last_seen_position);
    const currentPos = this.toNumberOrNull(metric.position);

    if (currentPos === null) {
      const nextRetryDate = addDaysISO(today, evaluation.cycle_days || 30);
      // 履歴にエラーを記録
      const { error: historyInsertError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluation_history')
        .insert({
          user_id: userId,
          content_annotation_id: evaluation.content_annotation_id,
          evaluation_date: today,
          outcome_type: 'error',
          error_code: 'no_metrics',
          error_message: `検索順位データ（position）が取得できませんでした。（次回再試行予定日: ${nextRetryDate}）`,
          suggestion_applied: false,
          created_at: new Date().toISOString(),
        });

      if (historyInsertError) {
        console.error(
          `[gscEvaluationService] Failed to save error history for evaluation ${evaluation.id}:`,
          historyInsertError
        );
      }

      await this.updateCooldown(evaluation.id, userId, today);

      return { status: 'skipped_no_metrics' };
    }

    // 初回評価はベースライン記録のみ（履歴・改善提案は生成しない）
    if (lastSeen === null) {
      const { error: updateError } = await this.supabaseService
        .getClient()
        .from('gsc_article_evaluations')
        .update({
          last_seen_position: currentPos,
          last_evaluated_on: today,
          updated_at: new Date().toISOString(),
        })
        .eq('id', evaluation.id)
        .eq('user_id', userId);

      if (updateError) {
        throw new Error(updateError.message || '評価レコード更新に失敗しました');
      }

      return { status: 'success', outcome: 'no_change' };
    }

    const outcome = this.judgeOutcome(lastSeen, currentPos);

    // 現在のステージを保存（提案生成に使用）
    const currentStage = evaluation.current_suggestion_stage || 1;

    // 次回のステージを計算
    let nextStage: number;
    if (outcome === 'improved') {
      // 改善された → ステージをリセット
      nextStage = 1;
    } else {
      // 改善されなかった（no_change or worse）→ ステージを進める（最大4で固定）
      nextStage = Math.min(currentStage + 1, 4);
    }

    // 更新: evaluations
    // base_evaluation_date は更新しない（固定された評価基準日として保持）
    const { error: updateError } = await this.supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .update({
        last_seen_position: currentPos,
        last_evaluated_on: today,
        current_suggestion_stage: nextStage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', evaluation.id)
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(updateError.message || '評価レコード更新に失敗しました');
    }

    // 挿入: history
    const { data: historyRow, error: historyError } = await this.supabaseService
      .getClient()
      .from('gsc_article_evaluation_history')
      .insert({
        user_id: userId,
        content_annotation_id: evaluation.content_annotation_id,
        evaluation_date: metric.date ?? today,
        previous_position: lastSeen,
        current_position: currentPos,
        outcome,
        outcome_type: 'success',
        suggestion_applied: false,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    if (historyError) {
      throw new Error(historyError.message || '評価履歴の保存に失敗しました');
    }

    // 改善提案: 改善していない場合のみ実行（Claude API 呼び出し）
    // 現在のステージで提案を生成（次回のステージではない）
    if (outcome !== 'improved' && historyRow?.id) {
      await gscSuggestionService.generate({
        userId,
        contentAnnotationId: evaluation.content_annotation_id,
        evaluationId: evaluation.id,
        evaluationHistoryId: historyRow.id,
        outcome,
        currentPosition: currentPos,
        previousPosition: lastSeen,
        currentSuggestionStage: currentStage, // 現在のステージを渡す
      });
    }

    return { status: 'success', outcome };
  }

  /** 最新の日次メトリクスを取得（content_annotation_id で直接紐付け） */
  private async fetchLatestMetric(
    userId: string,
    evaluation: GscEvaluationRow
  ): Promise<Pick<GscPageMetric, 'position' | 'date'> | null> {
    // 評価日は固定せず「最新取得済みの指標」を採用する。
    // 直近日が欠損/nullでも、最終取得日で判定できるよう null position は除外。
    const { data, error } = await this.supabaseService
      .getClient()
      .from('gsc_page_metrics')
      .select('position, date')
      .eq('user_id', userId)
      .eq('property_uri', evaluation.property_uri)
      .eq('content_annotation_id', evaluation.content_annotation_id)
      .not('position', 'is', null)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message || 'メトリクスの取得に失敗しました');
    }

    if (!data) return null;
    return data as Pick<GscPageMetric, 'position' | 'date'>;
  }

  /**
   * 次回評価予定日時に達した全ユーザーの評価を実行（Cron バッチ用）
   *
   * 条件: (last_evaluated_on ?? base_evaluation_date) + cycle_days の日付
   *       + evaluation_hour の時間 <= 現在日時(JST)
   */
  async runAllDueEvaluations(): Promise<BatchResultSummary> {
    const summary: BatchResultSummary = {
      usersProcessed: 0,
      usersAttempted: 0,
      usersSkippedDueToLimit: 0,
      stoppedReason: 'completed',
      totalEvaluations: 0,
      totalImproved: 0,
      totalAdvanced: 0,
      totalSkipped: 0,
      totalImportFailed: 0,
      totalSystemError: 0,
      errors: [],
    };

    const startTime = Date.now();

    // 現在の日本時間を取得
    const nowJst = this.getNowJst();
    const todayJst = formatDateISO(nowJst);
    const currentHourJst = nowJst.getHours();

    console.log(`[gscEvaluationService] Running batch at JST: ${todayJst} ${currentHourJst}:00`);

    // 全てのアクティブな評価対象を取得
    const { data: fetchedData, error: evalError } = await this.supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .select('*')
      .eq('status', 'active');

    if (evalError) {
      throw new Error(evalError.message || '評価対象の取得に失敗しました');
    }

    const evaluations = (fetchedData || []) as GscEvaluationRow[];

    // 次回評価予定日時に達しているものをフィルタリング
    const dueEvaluations = evaluations.filter(evaluation => {
      return this.isDue(evaluation, todayJst, currentHourJst);
    });

    if (dueEvaluations.length === 0) {
      console.log('[gscEvaluationService] No evaluations due at this time.');
      return summary;
    }

    console.log(
      `[gscEvaluationService] Found ${dueEvaluations.length} due evaluations out of ${evaluations.length} total`
    );

    // ユーザーIDでグルーピング
    const evaluationsByUserMap = new Map<string, GscEvaluationRow[]>();
    for (const evaluation of dueEvaluations) {
      const userId = evaluation.user_id;
      const existing = evaluationsByUserMap.get(userId) || [];
      existing.push(evaluation);
      evaluationsByUserMap.set(userId, existing);
    }

    // ユーザーリストを配列にしてシャッフル
    const userIds = Array.from(evaluationsByUserMap.keys());
    for (let i = userIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [userIds[i], userIds[j]] = [userIds[j]!, userIds[i]!];
    }

    // 各ユーザーの評価を実行
    for (const userId of userIds) {
      // 制限時間のチェック
      const elapsed = Date.now() - startTime;
      if (elapsed > GscEvaluationService.BATCH_TIME_LIMIT_MS) {
        const remaining = userIds.length - summary.usersAttempted;
        console.warn(
          `[gscEvaluationService] Time limit reached (${elapsed}ms). ` +
            `Stopping batch. Remaining: ${remaining} users.`
        );
        summary.stoppedReason = 'time_limit';
        summary.usersSkippedDueToLimit = remaining;
        break;
      }

      // 処理ユーザー数のチェック（試行回数で判定）
      if (summary.usersAttempted >= GscEvaluationService.MAX_USERS_PER_BATCH) {
        const remaining = userIds.length - summary.usersAttempted;
        console.log(
          `[gscEvaluationService] Max users per batch (${GscEvaluationService.MAX_USERS_PER_BATCH}) reached. ` +
            `Stopping batch. Remaining: ${remaining} users.`
        );
        summary.stoppedReason = 'max_users';
        summary.usersSkippedDueToLimit = remaining;
        break;
      }

      summary.usersAttempted++;
      const userEvaluations = evaluationsByUserMap.get(userId);
      if (!userEvaluations || userEvaluations.length === 0) {
        continue;
      }

      try {
        console.log(
          `[gscEvaluationService] Processing user ${userId} with ${userEvaluations.length} evaluations`
        );

        const result = await this.runDueEvaluationsForUser(userId, {
          evaluations: userEvaluations,
          nowJst,
          startTime,
        });

        summary.usersProcessed += 1;
        summary.totalEvaluations += result.processed;
        summary.totalImproved += result.improved;
        summary.totalAdvanced += result.advanced;
        summary.totalSkipped += result.skippedNoMetrics;
        summary.totalImportFailed += result.skippedImportFailed;
        summary.totalSystemError += result.skippedSystemError;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[gscEvaluationService] Error processing user ${userId}:`, message);
        summary.errors.push(`User ${userId}: ${message}`);
      }
    }

    console.log('[gscEvaluationService] Batch completed summary:', summary);
    return summary;
  }

  /**
   * 評価が予定日時に達しているかどうかを判定
   */
  private isDue(evaluation: GscEvaluationRow, todayJst: string, currentHourJst: number): boolean {
    const cycleDays = evaluation.cycle_days || 30;
    const evaluationHour = evaluation.evaluation_hour ?? 12;
    const baseDate = evaluation.last_evaluated_on ?? evaluation.base_evaluation_date;
    const nextEvaluationDate = addDaysISO(baseDate, cycleDays);

    // 日付が未到達の場合はスキップ
    if (nextEvaluationDate > todayJst) {
      return false;
    }

    // 日付が過去の場合は実行対象
    if (nextEvaluationDate < todayJst) {
      return true;
    }

    // 日付が今日の場合は時間をチェック
    // nextEvaluationDate === todayJst
    return currentHourJst >= evaluationHour;
  }

  /**
   * 現在の日本時間を取得
   */
  private getNowJst(): Date {
    const now = new Date();
    // UTC を JST (UTC+9) に変換
    const jstOffset = 9 * 60 * 60 * 1000;
    return new Date(now.getTime() + jstOffset);
  }

  private judgeOutcome(lastSeen: number | null, currentPos: number): GscEvaluationOutcome {
    if (lastSeen === null) return 'no_change';
    if (currentPos < lastSeen) return 'improved';
    if (currentPos > lastSeen) return 'worse';
    return 'no_change';
  }

  private async updateCooldown(evaluationId: string, userId: string, today: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('gsc_article_evaluations')
      .update({
        last_evaluated_on: today,
        updated_at: new Date().toISOString(),
      })
      .eq('id', evaluationId)
      .eq('user_id', userId);

    if (error) {
      console.error(
        `[gscEvaluationService] Failed to update last_evaluated_on for ${evaluationId}:`,
        error
      );
    }
  }

  private todayISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toNumberOrNull(value: unknown): number | null {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }
}

export const gscEvaluationService = new GscEvaluationService();
