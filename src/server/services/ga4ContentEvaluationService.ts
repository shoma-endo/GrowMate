import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database.types';
import type { AnnotationRecord } from '@/types/annotation';
import type { GscCredential } from '@/types/gsc';
import { normalizeToPath } from '@/lib/ga4-utils';
import {
  aggregateGa4EvaluationPageMetrics,
  type Ga4DailyMetricInput,
} from '@/server/lib/ga4-metrics-aggregation';
import {
  calculateAverageEngagementSeconds,
  calculateExpectedReadSeconds,
  calculateReadRate,
  evaluateGa4ContentScore,
  type DiagnosisResult,
} from '@/server/lib/ga4-content-scoring';
import {
  rankByContentScore,
  type ContentScoreRankingItem,
} from '@/server/lib/ga4-content-score-aggregation';
import { buildGa4EvaluationContext } from '@/server/lib/ga4-evaluation-context';
import { resolveGa4EvaluationDisplayStatus } from '@/server/lib/ga4-evaluation-status';
import {
  buildGa4EvaluationPromptVariables,
  renderGa4EvaluationUserPrompt,
} from '@/server/lib/ga4-content-evaluation-prompt';
import { generateGa4EvaluationLlmOutput } from '@/server/services/ga4EvaluationLlmService';
import { ga4EvaluationLlmOutputSchema, type Ga4EvaluationNarrative } from '@/server/schemas/ga4ContentEvaluation.schema';
import { MODEL_CONFIGS } from '@/lib/constants';
import { countContentChars } from '@/lib/content-text';
import { getGa4EvaluationDateRange } from '@/lib/ga4-evaluation-period';
import {
  isGa4PersistentEvaluationStatus,
  type Ga4ContentEvaluationView,
  type Ga4PersistentEvaluationStatus,
} from '@/types/ga4-evaluation';

const SYSTEM_TEMPLATE_NAME = 'ga4_content_evaluation_system';
const USER_TEMPLATE_NAME = 'ga4_content_evaluation_user';

interface RunGa4ContentEvaluationInput {
  userId: string;
  annotationId: string;
  startDate: string;
  endDate: string;
}

interface ScoringPersistValues {
  status: 'evaluated' | 'narrative_failed' | 'insufficient_data' | 'import_failed' | 'evaluation_failed';
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  readRate: number | null;
  engageRate: number | null;
  scrollRate: number | null;
  readScore: number | null;
  engageScore: number | null;
  contentScore: number | null;
  diagnosisCode: DiagnosisResult['code'] | null;
  siteRank: number | null;
  totalArticles: number | null;
  sessions: number | null;
  charCount: number | null;
  imageCount: number | null;
  expectedReadSeconds: number | null;
  avgEngagementSeconds: number | null;
  narrativeJson: Json;
  dataQualityJson: Json;
  periodStart: string | null;
  periodEnd: string | null;
  canonicalUrl: string | null;
  title: string | null;
  ga4PropertyId: string | null;
  ga4DataFetchedAt: string | null;
}

type EvaluationFailurePhase = 'import' | 'scoring' | 'narrative';

interface LatestGa4ContentScore {
  annotationId: string;
  title: string | null;
  normalizedPath: string | null;
  contentScore: number;
  readScore: number;
  engageScore: number;
  sessions: number;
}

interface EvaluationFailureOutcome {
  status: ScoringPersistValues['status'];
  errorCode: string;
  errorMessage: string;
}

function toSafeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === 'string' && /^[a-z0-9_]+$/.test(code)) return code.slice(0, 80);
  }
  return 'evaluation_failed';
}

function classifyEvaluationFailure(error: unknown, phase: EvaluationFailurePhase): EvaluationFailureOutcome {
  const errorCode = toSafeErrorCode(error);
  if (phase === 'narrative') {
    return { status: 'narrative_failed', errorCode, errorMessage: errorCode };
  }
  if (phase === 'import') {
    return { status: 'import_failed', errorCode: errorCode === 'evaluation_failed' ? 'ga4_api_error' : errorCode, errorMessage: errorCode };
  }
  return { status: 'evaluation_failed', errorCode, errorMessage: errorCode };
}

function toJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => toJson(item));
  if (typeof value === 'object') {
    const result: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) result[key] = toJson(item);
    return result;
  }
  return null;
}

function toPersistentStatus(
  value: string | null,
  annotationId: string
): Ga4PersistentEvaluationStatus | null {
  if (value === null) return null;
  if (isGa4PersistentEvaluationStatus(value)) return value;
  console.error('[Ga4ContentEvaluationService] unknown persisted status', { annotationId, value });
  return null;
}

// 生成型の RPC 引数は `p_x?: T` で null を受け付けないが、対象パラメータは SQL 側が
// すべて `default null` なので、キーを省略することが NULL 指定と等価になる。
function omitNullArgs<T extends Record<string, unknown>>(args: T): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== null && value !== undefined)
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}

function getLatestImportedAt(rows: readonly { imported_at?: string | null }[]): string | null {
  const importedAt = rows
    .map(row => row.imported_at)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return importedAt ?? null;
}

function getStoredScrollUsers(dataQuality: Json): number | null {
  if (typeof dataQuality !== 'object' || dataQuality === null || Array.isArray(dataQuality)) return null;
  const value = (dataQuality as Record<string, Json>).scrollUsers;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface ComputeGa4ScoreResult {
  outcome: 'evaluated' | 'insufficient_data' | 'low_data' | 'import_failed';
  errorCode: string | null;
  canonicalUrl: string | null;
  title: string | null;
  ga4PropertyId: string | null;
  ga4DataFetchedAt: string | null;
  context: ReturnType<typeof buildGa4EvaluationContext> | null;
  score: ReturnType<typeof evaluateGa4ContentScore> | null;
  sessions: number | null;
  charCount: number | null;
  imageCount: number | null;
  expectedReadSeconds: number | null;
  avgEngagementSeconds: number | null;
  readRate: number | null;
  engageRate: number | null;
  scrollRate: number | null;
  scrollUsers: number | null;
  dataQualityJson: Json;
}

class Ga4ContentEvaluationService extends SupabaseService {
  private async withEvaluationClient<T>(handler: (client: SupabaseClient<Database>) => Promise<T>): Promise<T> {
    return Ga4ContentEvaluationService.withServiceRoleClient(async client => handler(client), {
      logMessage: '[Ga4ContentEvaluationService] service role operation failed',
    });
  }

  private async resolveInitialDisplayStatus(
    userId: string,
    annotationId: string,
    period: { startDate: string; endDate: string },
    credential: GscCredential | null
  ): Promise<{ status: 'unassessed' | 'eligible' | 'low_data'; missingMetrics: string[] }> {
    const propertyId = credential?.ga4PropertyId;
    if (!propertyId) return { status: 'unassessed', missingMetrics: ['ga4_property'] };

    return Ga4ContentEvaluationService.withServiceRoleClient(async rawClient => {
      const client = rawClient;
      const { data: annotation, error: annotationError } = await client
        .from('content_annotations')
        .select('id,canonical_url,wp_content_text')
        .eq('user_id', userId)
        .eq('id', annotationId)
        .maybeSingle();
      if (annotationError) throw annotationError;
      if (!annotation?.canonical_url || countContentChars(annotation.wp_content_text) === 0) {
        return { status: 'unassessed', missingMetrics: ['article_content'] };
      }

      const { data: rows, error: metricsError } = await client
        .from('ga4_page_metrics_daily')
        .select('date,normalized_path,sessions,users,engagement_time_sec,bounce_rate,engagement_rate,active_users,cv_event_count,scroll_90_event_count,search_clicks,impressions,is_sampled,is_partial')
        .eq('user_id', userId)
        .eq('property_id', propertyId)
        .eq('normalized_path', normalizeToPath(annotation.canonical_url))
        .gte('date', period.startDate)
        .lte('date', period.endDate);
      if (metricsError) throw metricsError;
      if (!rows || rows.length === 0) return { status: 'unassessed', missingMetrics: ['ga4_data'] };

      const dailyMetrics: Array<Ga4DailyMetricInput & { date: string }> = rows.flatMap(row => {
        if (typeof row.normalized_path !== 'string') return [];
        return [{
        date: row.date,
        normalizedPath: row.normalized_path,
        sessions: Number(row.sessions ?? 0),
        users: Number(row.users ?? 0),
        engagementTimeSec: Number(row.engagement_time_sec ?? 0),
        bounceRate: Number(row.bounce_rate ?? 0),
        engagementRate: row.engagement_rate,
        activeUsers: row.active_users,
        cvEventCount: Number(row.cv_event_count ?? 0),
        scroll90EventCount: row.scroll_90_event_count === null ? null : Number(row.scroll_90_event_count),
        searchClicks: Number(row.search_clicks ?? 0),
        impressions: Number(row.impressions ?? 0),
        isSampled: Boolean(row.is_sampled),
        isPartial: Boolean(row.is_partial),
        }];
      });
      const summary = aggregateGa4EvaluationPageMetrics(dailyMetrics, period.startDate, period.endDate).get(normalizeToPath(annotation.canonical_url));
      if (!summary) return { status: 'unassessed', missingMetrics: ['ga4_data'] };
      if (summary.sessions < 30) return { status: 'low_data', missingMetrics: [] };
      const missingMetrics = [
        ...(summary.engagementRate === null ? ['engagement_rate'] : []),
        ...(summary.activeUsers === null ? ['active_users'] : []),
      ];
      return missingMetrics.length > 0
        ? { status: 'unassessed', missingMetrics }
        : { status: 'eligible', missingMetrics: [] };
    }, { logMessage: '[Ga4ContentEvaluationService] initial status read failed' });
  }

  async fetchEvaluation(userId: string, annotationId: string): Promise<Ga4ContentEvaluationView> {
    const credential = await this.getGscCredentialByUserId(userId);
    const displayPeriod = getGa4EvaluationDateRange();
    return this.withEvaluationClient(async client => {
      const [{ data: projection, error: projectionError }, { data: history, error: historyError }] = await Promise.all([
        client.from('ga4_content_evaluations').select('*').eq('user_id', userId).eq('content_annotation_id', annotationId).maybeSingle(),
        client.from('ga4_content_evaluation_history').select('*').eq('user_id', userId).eq('content_annotation_id', annotationId).order('created_at', { ascending: false }).limit(20),
      ]);
      if (projectionError) throw projectionError;
      if (historyError) throw historyError;
      const historyRows = [...(history ?? [])];
      const lastSuccessHistoryId = projection?.last_success_history_id;
      if (lastSuccessHistoryId && !historyRows.some(row => row.id === lastSuccessHistoryId)) {
        const { data: lastSuccess, error: lastSuccessError } = await client
          .from('ga4_content_evaluation_history')
          .select('*')
          .eq('user_id', userId)
          .eq('content_annotation_id', annotationId)
          .eq('id', lastSuccessHistoryId)
          .maybeSingle();
        if (lastSuccessError) throw lastSuccessError;
        if (lastSuccess) historyRows.push(lastSuccess);
      }
      const settingsEnabled = true;
      const viewHistory = historyRows.flatMap(row => {
        const rowStatus = toPersistentStatus(row.status, annotationId);
        if (!rowStatus) return [];
        return [{
        id: row.id,
        status: rowStatus,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        attemptCount: row.attempt_count,
        readRate: row.read_rate,
        engageRate: row.engage_rate,
        scrollRate: row.scroll_rate,
        readScore: row.read_score,
        engageScore: row.engage_score,
        contentScore: row.content_score,
        diagnosisCode: row.diagnosis_code,
        siteRank: row.site_rank,
        totalArticles: row.total_articles,
        sessions: row.sessions,
        charCount: row.char_count,
        imageCount: row.image_count,
        expectedReadSeconds: row.expected_read_seconds,
        avgEngagementSeconds: row.avg_engagement_seconds,
        narrative: ga4EvaluationLlmOutputSchema.safeParse(row.narrative_json).success
          ? ga4EvaluationLlmOutputSchema.parse(row.narrative_json)
          : null,
        dataQuality: row.data_quality_json,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        ga4DataFetchedAt: row.ga4_data_fetched_at,
        errorCode: row.error_code,
        }];
      }).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
      const initialDisplay = !projection && viewHistory.length === 0
        ? await this.resolveInitialDisplayStatus(userId, annotationId, displayPeriod, credential)
        : null;
      const persistedStatus = toPersistentStatus(projection?.status ?? null, annotationId);
      return {
        settingsEnabled,
        missingMetrics: initialDisplay?.missingMetrics ?? [],
        displayStatus: resolveGa4EvaluationDisplayStatus({
          persistedStatus,
          ...(initialDisplay ? { derivedStatus: initialDisplay.status } : {}),
        }),
        projection: projection && persistedStatus ? {
          status: persistedStatus,
          lastSuccessHistoryId: projection.last_success_history_id,
          lastSuccessEvaluatedAt: projection.last_success_evaluated_at,
          lastErrorCode: projection.last_error_code,
        } : null,
        history: viewHistory,
      };
    });
  }

  /**
   * GA4データ取得〜スコア算出まで（LLM呼び出し・DB永続化を含まない）を run() / computeBaselineScore()
   * の両方から使う共通ヘルパー。例外は投げず outcome で表す（D10当時「専用の計測経路を新設すると
   * 評価パイプライン全体を複製することになる」として却下された懸念を、LLM呼び出しより手前に
   * 分岐点を置くことで回避する）。
   */
  private async computeGa4Score(input: RunGa4ContentEvaluationInput): Promise<ComputeGa4ScoreResult> {
    const base: ComputeGa4ScoreResult = {
      outcome: 'import_failed', errorCode: null, canonicalUrl: null, title: null, ga4PropertyId: null,
      ga4DataFetchedAt: null, context: null, score: null, sessions: null, charCount: null, imageCount: null,
      expectedReadSeconds: null, avgEngagementSeconds: null, readRate: null, engageRate: null, scrollRate: null,
      scrollUsers: null, dataQualityJson: {},
    };
    try {
      const client = this.getClient();
      const { data: annotation, error: annotationError } = await client
        .from('content_annotations')
        .select('*')
        .eq('user_id', input.userId)
        .eq('id', input.annotationId)
        .maybeSingle();
      if (annotationError || !annotation) throw annotationError ?? new Error('annotation not found');
      const credential = await this.getGscCredentialByUserId(input.userId);
      const propertyId = credential?.ga4PropertyId ?? null;
      base.canonicalUrl = annotation.canonical_url;
      base.title = annotation.wp_post_title;
      base.ga4PropertyId = propertyId;
      if (!propertyId || !annotation.canonical_url) throw new Error('GA4 property or canonical URL missing');

      const normalizedPath = normalizeToPath(annotation.canonical_url);
      const { data: rows, error: metricsError, count: metricCount } = await client
        .from('ga4_page_metrics_daily')
        .select('date,normalized_path,sessions,users,engagement_time_sec,bounce_rate,engagement_rate,active_users,cv_event_count,scroll_90_event_count,search_clicks,impressions,is_sampled,is_partial,imported_at', { count: 'exact' })
        .eq('user_id', input.userId)
        .eq('property_id', propertyId)
        .eq('normalized_path', normalizedPath)
        .gte('date', input.startDate)
        .lte('date', input.endDate);
      if (metricsError) throw metricsError;
      const dailyMetrics: Array<Ga4DailyMetricInput & { date: string }> = (rows ?? []).flatMap(row => {
        if (typeof row.normalized_path !== 'string') return [];
        return [{
        date: row.date,
        normalizedPath: row.normalized_path,
        sessions: Number(row.sessions ?? 0), users: Number(row.users ?? 0),
        engagementTimeSec: Number(row.engagement_time_sec ?? 0), bounceRate: Number(row.bounce_rate ?? 0),
        engagementRate: row.engagement_rate, activeUsers: row.active_users,
        cvEventCount: Number(row.cv_event_count ?? 0), scroll90EventCount: row.scroll_90_event_count === null ? null : Number(row.scroll_90_event_count),
        searchClicks: Number(row.search_clicks ?? 0), impressions: Number(row.impressions ?? 0),
        isSampled: Boolean(row.is_sampled), isPartial: Boolean(row.is_partial),
        }];
      }).sort((left, right) => left.date.localeCompare(right.date) || left.normalizedPath.localeCompare(right.normalizedPath));
      const summary = aggregateGa4EvaluationPageMetrics(dailyMetrics, input.startDate, input.endDate).get(normalizedPath) ?? null;
      base.ga4DataFetchedAt = getLatestImportedAt(rows ?? []);

      const context = buildGa4EvaluationContext({
        annotation: annotation as AnnotationRecord,
        startDate: input.startDate, endDate: input.endDate, ga4Summary: summary,
        ga4DailyMetrics: dailyMetrics, gscSummary: null, ga4FetchedAt: base.ga4DataFetchedAt, gscFetchedAt: null,
        ga4MetricsTruncated: metricCount !== null && metricCount !== undefined && dailyMetrics.length < metricCount,
      });
      const sessions = summary?.sessions ?? 0;
      const expectedReadSeconds = calculateExpectedReadSeconds(context.article.charCount, context.article.imageCount);
      const activeEngagementTime = dailyMetrics.filter(row => row.activeUsers !== null).reduce((total, row) => total + row.engagementTimeSec, 0);
      const avgEngagementSeconds = calculateAverageEngagementSeconds(activeEngagementTime, summary?.activeUsers ?? null);
      const readRate = calculateReadRate(avgEngagementSeconds, expectedReadSeconds);
      const engageRate = summary?.engagementRate ?? null;
      const scrollRate = summary?.scrollMetricsAvailable === true && sessions > 0
        ? summary.scroll90EventCount / sessions
        : null;
      const score = evaluateGa4ContentScore({ sessions, readRate, engagementRate: engageRate, scrollRate });
      const scrollUsers = summary?.scrollMetricsAvailable === false ? null : summary?.scroll90EventCount ?? null;

      return {
        ...base,
        context, score, sessions,
        charCount: context.article.charCount, imageCount: context.article.imageCount,
        expectedReadSeconds, avgEngagementSeconds, readRate, engageRate, scrollRate, scrollUsers,
        dataQualityJson: toJson({ ...context.dataQuality, scrollUsers }),
        outcome: score.status === 'low_data' ? 'low_data' : score.status === 'evaluated' ? 'evaluated' : 'insufficient_data',
      };
    } catch (error) {
      return { ...base, outcome: 'import_failed', errorCode: toSafeErrorCode(error) };
    }
  }

  async run(input: RunGa4ContentEvaluationInput): Promise<Ga4ContentEvaluationView> {
    const credential = await this.getGscCredentialByUserId(input.userId);
    const initialStatus = await this.resolveInitialDisplayStatus(input.userId, input.annotationId, {
      startDate: input.startDate,
      endDate: input.endDate,
    }, credential);
    if (initialStatus.status === 'low_data') {
      return this.fetchEvaluation(input.userId, input.annotationId);
    }
    const runId = await this.startRun(input.userId, input.annotationId);
    let values: ScoringPersistValues = {
      status: 'evaluation_failed', errorCode: 'evaluation_failed', errorMessage: 'evaluation_failed', attemptCount: 0,
      readRate: null, engageRate: null, scrollRate: null, readScore: null, engageScore: null, contentScore: null,
      diagnosisCode: null, siteRank: null, totalArticles: null, sessions: null, charCount: null, imageCount: null,
      expectedReadSeconds: null, avgEngagementSeconds: null, narrativeJson: null,
      dataQualityJson: {},
      periodStart: input.startDate, periodEnd: input.endDate, canonicalUrl: null, title: null, ga4PropertyId: null,
      ga4DataFetchedAt: null,
    };

    const computed = await this.computeGa4Score(input);
    values = {
      ...values,
      canonicalUrl: computed.canonicalUrl,
      title: computed.title,
      ga4PropertyId: computed.ga4PropertyId,
      ga4DataFetchedAt: computed.ga4DataFetchedAt,
    };

    if (computed.outcome === 'import_failed') {
      const failure = classifyEvaluationFailure({ code: computed.errorCode ?? 'evaluation_failed' }, 'import');
      values = { ...values, status: failure.status, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
      await this.finishRun(input, runId, values);
      return this.fetchEvaluation(input.userId, input.annotationId);
    }
    if (computed.outcome === 'low_data') {
      await this.cancelRun(input, runId);
      return this.fetchEvaluation(input.userId, input.annotationId);
    }

    const score = computed.score!;
    values = {
      ...values, status: computed.outcome === 'evaluated' ? 'evaluated' : 'insufficient_data',
      errorCode: computed.outcome === 'evaluated' ? null : 'insufficient_data', errorMessage: null,
      readRate: computed.readRate, engageRate: computed.engageRate, scrollRate: computed.scrollRate,
      readScore: score.readScore, engageScore: score.engageScore,
      contentScore: score.contentScore, diagnosisCode: computed.outcome === 'evaluated' ? score.diagnosis.code : null,
      sessions: computed.sessions, charCount: computed.charCount, imageCount: computed.imageCount,
      expectedReadSeconds: computed.expectedReadSeconds,
      avgEngagementSeconds: computed.avgEngagementSeconds,
      dataQualityJson: computed.dataQualityJson,
    };
    if (computed.outcome === 'evaluated') {
      try {
        const ranking = await this.calculateRank(input.userId, input.annotationId, {
          id: input.annotationId, contentScore: score.contentScore!, sessions: computed.sessions!,
          readScore: score.readScore!, engageScore: score.engageScore!,
        });
        values = { ...values, siteRank: ranking.rank, totalArticles: ranking.totalArticles };
        const previous = await this.findPreviousSuccessfulScores(input.userId, input.annotationId);
        try {
          const narrative = await this.generateNarrative(computed.context!, score, ranking.rank, ranking.totalArticles, runId, input, {
            sessions: computed.sessions!,
            expectedReadSeconds: computed.expectedReadSeconds!,
            avgEngagementSeconds: computed.avgEngagementSeconds,
            scrollUsers: computed.scrollUsers,
            scrollRate: computed.scrollRate,
            previous,
          });
          values = {
            ...values,
            status: narrative.success ? 'evaluated' : 'narrative_failed',
            errorCode: narrative.success ? null : narrative.code,
            errorMessage: narrative.success ? null : narrative.code,
            attemptCount: narrative.attemptCount,
            narrativeJson: narrative.success ? toJson(narrative.data) : null,
          };
        } catch (error) {
          const failure = classifyEvaluationFailure(error, 'narrative');
          values = { ...values, status: failure.status, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
        }
      } catch (error) {
        const failure = classifyEvaluationFailure(error, 'scoring');
        values = { ...values, status: failure.status, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
      }
    }
    await this.finishRun(input, runId, values);
    return this.fetchEvaluation(input.userId, input.annotationId);
  }

  /**
   * 定期評価バッチの初回パス（ベースラインのみ）専用。スコア・診断コードの算出のみを行い、
   * LLM診断コメント生成・ga4_content_evaluation_history/ga4_content_evaluationsへの書き込みは
   * 一切行わない（GSCの gscEvaluationService.processEvaluation の last_seen_position===null
   * 分岐と同型。last_seen_position 相当は ga4_content_evaluation_cycles.last_seen_content_score
   * にのみ書く。呼び出し元は ga4ContentEvaluationCycleService）。
   */
  async computeBaselineScore(
    input: RunGa4ContentEvaluationInput
  ): Promise<{ status: 'scored' | 'low_data' | 'import_failed'; contentScore: number | null }> {
    const credential = await this.getGscCredentialByUserId(input.userId);
    const initialStatus = await this.resolveInitialDisplayStatus(input.userId, input.annotationId, {
      startDate: input.startDate,
      endDate: input.endDate,
    }, credential);
    if (initialStatus.status === 'low_data') return { status: 'low_data', contentScore: null };

    const computed = await this.computeGa4Score(input);
    if (computed.outcome === 'import_failed') return { status: 'import_failed', contentScore: null };
    if (computed.outcome === 'evaluated') return { status: 'scored', contentScore: computed.score!.contentScore };
    // 'insufficient_data' もここでは「まだ確定したスコアを出せない」の扱いに丸める
    // （GSCの no_metrics と同様、次サイクルで再試行する。§6.6.4）
    return { status: 'low_data', contentScore: null };
  }

  private async startRun(userId: string, annotationId: string): Promise<string> {
    return this.withEvaluationClient(async client => {
      const { data, error } = await client.rpc('start_ga4_content_evaluation', { p_user_id: userId, p_content_annotation_id: annotationId });
      if (error) throw error;
      const runId = data?.[0]?.evaluation_run_id;
      if (!runId) throw new Error('evaluation run id missing');
      return runId;
    });
  }

  private async updateAttemptCount(input: RunGa4ContentEvaluationInput, runId: string, attemptCount: number): Promise<void> {
    await this.withEvaluationClient(async client => {
      const { data, error } = await client.rpc('update_ga4_content_evaluation_attempt', {
        p_user_id: input.userId,
        p_content_annotation_id: input.annotationId,
        p_evaluation_run_id: runId,
        p_attempt_count: attemptCount,
      });
      if (error) throw error;
      if (data !== true) throw new Error('evaluation attempt update failed');
    });
  }

  private async finishRun(input: RunGa4ContentEvaluationInput, runId: string, values: ScoringPersistValues): Promise<void> {
    await this.withEvaluationClient(async client => {
      const { error } = await client.rpc('finish_ga4_content_evaluation', {
        p_user_id: input.userId, p_content_annotation_id: input.annotationId, p_evaluation_run_id: runId,
        p_status: values.status,
        p_attempt_count: values.attemptCount,
        ...omitNullArgs({
          p_error_code: values.errorCode, p_error_message: values.errorMessage,
          p_read_rate: values.readRate, p_engage_rate: values.engageRate,
          p_scroll_rate: values.scrollRate, p_read_score: values.readScore, p_engage_score: values.engageScore,
          p_content_score: values.contentScore, p_diagnosis_code: values.diagnosisCode, p_site_rank: values.siteRank,
          p_total_articles: values.totalArticles, p_sessions: values.sessions, p_char_count: values.charCount,
          p_image_count: values.imageCount, p_expected_read_seconds: values.expectedReadSeconds,
          p_avg_engagement_seconds: values.avgEngagementSeconds, p_narrative_json: values.narrativeJson,
          p_data_quality_json: values.dataQualityJson, p_period_start: values.periodStart, p_period_end: values.periodEnd,
          p_canonical_url_snapshot: values.canonicalUrl, p_title_snapshot: values.title,
          p_ga4_property_id: values.ga4PropertyId, p_ga4_data_fetched_at: values.ga4DataFetchedAt,
        }),
      });
      if (error) throw error;
    });
  }

  private async cancelRun(input: RunGa4ContentEvaluationInput, runId: string): Promise<void> {
    await this.withEvaluationClient(async client => {
      const { data, error } = await client.rpc('cancel_ga4_content_evaluation', {
        p_user_id: input.userId,
        p_content_annotation_id: input.annotationId,
        p_evaluation_run_id: runId,
      });
      if (error) throw error;
      if (data !== true) throw new Error('evaluation cancellation failed');
    });
  }

  async retryNarrative(userId: string, annotationId: string): Promise<Ga4ContentEvaluationView> {
    const source = await this.withEvaluationClient(async client => {
      const { data: projection, error: projectionError } = await client
        .from('ga4_content_evaluations')
        .select('status,last_success_history_id')
        .eq('user_id', userId)
        .eq('content_annotation_id', annotationId)
        .maybeSingle();
      if (projectionError) throw projectionError;
      if (projection?.status !== 'narrative_failed' || !projection.last_success_history_id) {
        throw new Error('narrative retry is not available');
      }
      const { data: history, error: historyError } = await client
        .from('ga4_content_evaluation_history')
        .select('*')
        .eq('user_id', userId)
        .eq('content_annotation_id', annotationId)
        .eq('id', projection.last_success_history_id)
        .maybeSingle();
      if (historyError) throw historyError;
      if (!history || history.status !== 'narrative_failed') throw new Error('narrative retry source is missing');
      const { data: annotation, error: annotationError } = await client
        .from('content_annotations')
        .select('*')
        .eq('user_id', userId)
        .eq('id', annotationId)
        .maybeSingle();
      if (annotationError) throw annotationError;
      if (!annotation) throw new Error('annotation not found');
      return { history, annotation };
    });

    const periodStart = source.history.period_start;
    const periodEnd = source.history.period_end;
    if (!periodStart || !periodEnd || source.history.site_rank === null || source.history.total_articles === null || source.history.sessions === null || source.history.expected_read_seconds === null || source.history.read_score === null || source.history.engage_score === null || source.history.content_score === null || source.history.diagnosis_code === null) {
      throw new Error('narrative retry source is incomplete');
    }
    const runInput: RunGa4ContentEvaluationInput = { userId, annotationId, startDate: periodStart, endDate: periodEnd };
    const runId = await this.startRun(userId, annotationId);
    let values: ScoringPersistValues = {
      status: 'narrative_failed',
      errorCode: null,
      errorMessage: null,
      attemptCount: 0,
      readRate: source.history.read_rate,
      engageRate: source.history.engage_rate,
      scrollRate: source.history.scroll_rate,
      readScore: source.history.read_score,
      engageScore: source.history.engage_score,
      contentScore: source.history.content_score,
      diagnosisCode: source.history.diagnosis_code as DiagnosisResult['code'],
      siteRank: source.history.site_rank,
      totalArticles: source.history.total_articles,
      sessions: source.history.sessions,
      charCount: source.history.char_count,
      imageCount: source.history.image_count,
      expectedReadSeconds: source.history.expected_read_seconds,
      avgEngagementSeconds: source.history.avg_engagement_seconds,
      narrativeJson: null,
      dataQualityJson: source.history.data_quality_json,
      periodStart,
      periodEnd,
      canonicalUrl: source.history.canonical_url_snapshot,
      title: source.history.title_snapshot,
      ga4PropertyId: source.history.ga4_property_id,
      ga4DataFetchedAt: source.history.ga4_data_fetched_at,
    };
    try {
      const contextBase = buildGa4EvaluationContext({
        annotation: source.annotation as AnnotationRecord,
        startDate: periodStart,
        endDate: periodEnd,
        ga4Summary: null,
        ga4DailyMetrics: [],
        gscSummary: null,
        ga4FetchedAt: source.history.ga4_data_fetched_at,
        gscFetchedAt: null,
      });
      const score = {
        status: 'evaluated' as const,
        readRate: source.history.read_rate,
        engageRate: source.history.engage_rate,
        readScore: source.history.read_score,
        engageScore: source.history.engage_score,
        contentScore: source.history.content_score,
        diagnosis: { code: source.history.diagnosis_code as DiagnosisResult['code'], auxiliaryLabel: null },
      };
      const previous = await this.findPreviousSuccessfulScores(userId, annotationId, source.history.id);
      const narrative = await this.generateNarrative(contextBase, score, source.history.site_rank, source.history.total_articles, runId, runInput, {
        sessions: source.history.sessions,
        expectedReadSeconds: source.history.expected_read_seconds,
        avgEngagementSeconds: source.history.avg_engagement_seconds,
        scrollUsers: getStoredScrollUsers(source.history.data_quality_json),
        scrollRate: source.history.scroll_rate,
        previous,
      });
      values = {
        ...values,
        status: narrative.success ? 'evaluated' : 'narrative_failed',
        errorCode: narrative.success ? null : narrative.code,
        errorMessage: narrative.success ? null : narrative.code,
        attemptCount: narrative.attemptCount,
        narrativeJson: narrative.success ? toJson(narrative.data) : null,
      };
    } catch (error) {
      const failure = classifyEvaluationFailure(error, 'narrative');
      values = { ...values, status: failure.status, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
    }
    await this.finishRun(runInput, runId, values);
    return this.fetchEvaluation(userId, annotationId);
  }

  async fetchLatestSuccessfulContentScores(userId: string): Promise<LatestGa4ContentScore[]> {
    return this.withEvaluationClient(async client => {
      const projections = await this.fetchAllPaged(
        (from, to) => client
          .from('ga4_content_evaluations')
          .select('content_annotation_id,last_success_history_id', { count: 'exact' })
          .eq('user_id', userId)
          .not('last_success_history_id', 'is', null)
          .order('content_annotation_id', { ascending: true })
          .range(from, to),
        { pageSize: 500 }
      );
      if (projections.error) throw projections.error;
      if (projections.truncated) throw new Error('latest evaluation projections truncated');

      const projectionRows = projections.data.flatMap(row => row.last_success_history_id === null
        ? []
        : [{ content_annotation_id: row.content_annotation_id, last_success_history_id: row.last_success_history_id }]);
      const historyIds = Array.from(new Set(projectionRows.map(row => row.last_success_history_id)));
      const historyRows: Array<{
        id: string;
        content_annotation_id: string;
        status: string;
        content_score: number | null;
        sessions: number | null;
        read_score: number | null;
        engage_score: number | null;
      }> = [];
      for (let index = 0; index < historyIds.length; index += 500) {
        const ids = historyIds.slice(index, index + 500);
        const { data, error } = await client
          .from('ga4_content_evaluation_history')
          .select('id,content_annotation_id,status,content_score,sessions,read_score,engage_score')
          .eq('user_id', userId)
          .in('id', ids);
        if (error) throw error;
        historyRows.push(...(data ?? []));
      }

      const annotationIds = Array.from(new Set(projectionRows.map(row => row.content_annotation_id)));
      const annotations: Array<{ id: string; canonical_url: string | null; wp_post_title: string | null }> = [];
      for (let index = 0; index < annotationIds.length; index += 500) {
        const ids = annotationIds.slice(index, index + 500);
        const { data, error } = await client
          .from('content_annotations')
          .select('id,canonical_url,wp_post_title')
          .eq('user_id', userId)
          .in('id', ids);
        if (error) throw error;
        annotations.push(...(data ?? []));
      }

      const historyById = new Map(historyRows.map(row => [row.id, row]));
      const annotationById = new Map(annotations.map(annotation => [annotation.id, annotation]));
      return projectionRows.flatMap(projection => {
        const history = historyById.get(projection.last_success_history_id);
        const annotation = annotationById.get(projection.content_annotation_id);
        if (!history || !annotation || !['evaluated', 'narrative_failed'].includes(history.status)) return [];
        if (history.content_score === null || history.sessions === null || history.read_score === null || history.engage_score === null) return [];
        return [{
          annotationId: projection.content_annotation_id,
          title: annotation.wp_post_title,
          normalizedPath: annotation.canonical_url ? normalizeToPath(annotation.canonical_url) : null,
          contentScore: history.content_score,
          readScore: history.read_score,
          engageScore: history.engage_score,
          sessions: history.sessions,
        }];
      });
    });
  }

  private async calculateRank(userId: string, annotationId: string, current: ContentScoreRankingItem): Promise<{ rank: number; totalArticles: number }> {
    const latestScores = await this.fetchLatestSuccessfulContentScores(userId);
    const items = latestScores.map(({ annotationId: id, contentScore, sessions, readScore, engageScore }) => ({
      id,
      contentScore,
      sessions,
      readScore,
      engageScore,
    }));
    const currentItems = items.filter(item => item.id !== annotationId).concat(current);
    const ranked = rankByContentScore(currentItems);
    const currentRank = ranked.find(item => item.id === annotationId)?.rank;
    if (!currentRank) throw new Error('evaluation rank missing');
    return { rank: currentRank, totalArticles: currentItems.length };
  }

  private async findPreviousSuccessfulScores(userId: string, annotationId: string, excludedHistoryId?: string): Promise<{
    contentScore: number | null;
    engageScore: number | null;
    readScore: number | null;
  }> {
    return this.withEvaluationClient(async client => {
      let query = client
        .from('ga4_content_evaluation_history')
        .select('content_score,engage_score,read_score')
        .eq('user_id', userId)
        .eq('content_annotation_id', annotationId)
        .in('status', ['evaluated', 'narrative_failed']);
      if (excludedHistoryId) query = query.neq('id', excludedHistoryId);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      const previous = data?.[0];
      return {
        contentScore: previous?.content_score ?? null,
        engageScore: previous?.engage_score ?? null,
        readScore: previous?.read_score ?? null,
      };
    });
  }

  private async generateNarrative(
    context: ReturnType<typeof buildGa4EvaluationContext>,
    score: ReturnType<typeof evaluateGa4ContentScore>,
    rank: number,
    totalArticles: number,
    runId: string,
    runInput: RunGa4ContentEvaluationInput,
    values: {
      sessions: number;
      expectedReadSeconds: number;
      avgEngagementSeconds: number | null;
      scrollUsers: number | null;
      scrollRate: number | null;
      previous: { contentScore: number | null; engageScore: number | null; readScore: number | null };
    }
  ): Promise<Ga4EvaluationLlmResult> {
    const config = MODEL_CONFIGS.ga4_content_evaluation;
    if (!config) throw new Error('GA4 evaluation model config missing');
    const [systemTemplate, userTemplate] = await Promise.all([
      PromptService.getTemplateByName(SYSTEM_TEMPLATE_NAME),
      PromptService.getTemplateByName(USER_TEMPLATE_NAME),
    ]);
    if (!systemTemplate || !userTemplate || !systemTemplate.content.trim() || !userTemplate.content.trim()) {
      return { success: false, code: 'llm_output_invalid', attemptCount: 0 };
    }
    const variables = buildGa4EvaluationPromptVariables(context, {
      contentScore: score.contentScore!,
      engageScore: score.engageScore!,
      readScore: score.readScore!,
      diagnosisCode: score.diagnosis.code,
      rank,
      totalArticles,
      previousContentScore: values.previous.contentScore,
      previousEngageScore: values.previous.engageScore,
      previousReadScore: values.previous.readScore,
    }, {
      sessions: values.sessions,
      engagedUsers: Math.round((score.engageRate ?? 0) * values.sessions),
      engagementRate: score.engageRate,
      avgEngagementSeconds: values.avgEngagementSeconds,
      expectedReadSeconds: values.expectedReadSeconds,
      readRate: score.readRate,
      scrollUsers: values.scrollUsers,
      scrollRate: values.scrollRate,
    });
    const result = await generateGa4EvaluationLlmOutput({
      provider: config.provider,
      model: config.actualModel,
      systemPrompt: PromptService.replaceVariables(systemTemplate.content, variables),
      userPrompt: renderGa4EvaluationUserPrompt(userTemplate.content, variables, { scrollUsers: values.scrollUsers, scrollRate: values.scrollRate }),
      schema: ga4EvaluationLlmOutputSchema,
      maxTokens: config.maxTokens,
      onAttempt: attemptCount => this.updateAttemptCount(runInput, runId, attemptCount),
    });
    if (result.success) return { success: true, data: result.data, attemptCount: result.attemptCount };
    return { success: false, code: result.code, attemptCount: result.attemptCount };
  }
}

type Ga4EvaluationLlmResult =
  | {
      success: true;
      data: Ga4EvaluationNarrative;
      attemptCount: number;
    }
  | {
      success: false;
      code: string;
      attemptCount: number;
    };

export const ga4ContentEvaluationService = new Ga4ContentEvaluationService();
