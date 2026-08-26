import type { Json } from './database.types';

const GA4_PERSISTENT_EVALUATION_STATUSES = [
  'evaluated',
  'narrative_failed',
  'insufficient_data',
  'import_failed',
  'evaluation_failed',
  'evaluating',
] as const;

export type Ga4PersistentEvaluationStatus =
  (typeof GA4_PERSISTENT_EVALUATION_STATUSES)[number];

/**
 * DB の status 列は text + CHECK 制約なので生成型では `string` になる。
 * 読み取り境界でこの union へ絞り込む。想定外の値は呼び出し側でログして null 扱いにする。
 */
export function isGa4PersistentEvaluationStatus(
  value: string
): value is Ga4PersistentEvaluationStatus {
  return (GA4_PERSISTENT_EVALUATION_STATUSES as readonly string[]).includes(value);
}

const GA4_EVALUATION_DISPLAY_STATUSES = [
  'unassessed',
  'eligible',
  'low_data',
  ...GA4_PERSISTENT_EVALUATION_STATUSES,
] as const;

export type Ga4EvaluationDisplayStatus = (typeof GA4_EVALUATION_DISPLAY_STATUSES)[number];

/**
 * GA4コンテンツ評価のスケジュール表示に必要な最小限。
 *
 * 2026-08-26にGSC検索順位評価とサイクルを1本へ統合したため、基準日・サイクル日数・実行時刻は
 * `gsc_article_evaluations` の1行が正になった。GA4側の進捗（ga4_last_evaluated_on /
 * ga4_last_seen_content_score）だけが系統別に持たれる（§6.6.2）。
 */
export interface Ga4EvaluationScheduleView {
  baseEvaluationDate: string;
  cycleDays: number;
  evaluationHour: number;
  ga4LastEvaluatedOn: string | null;
  ga4LastSeenContentScore: number | null;
}

export type Ga4EvaluationErrorCode =
  | 'evaluation_run_expired'
  | 'ga4_api_error'
  | 'llm_rate_limited'
  | 'llm_server_error'
  | 'llm_timeout'
  | 'llm_output_invalid'
  | 'unknown';

interface Ga4EvaluationNarrativeView {
  headline: string;
  situation: string;
  cause: string;
  next_action: string;
  target: string;
}

export interface Ga4ContentEvaluationView {
  settingsEnabled: boolean;
  displayStatus: Ga4EvaluationDisplayStatus;
  missingMetrics: string[];
  projection: {
    status: Ga4PersistentEvaluationStatus;
    lastSuccessHistoryId: string | null;
    lastSuccessEvaluatedAt: string | null;
    lastErrorCode: string | null;
  } | null;
  history: Array<{
    id: string;
    status: Ga4PersistentEvaluationStatus;
    startedAt: string;
    completedAt: string | null;
    attemptCount: number;
    readRate: number | null;
    engageRate: number | null;
    scrollRate: number | null;
    readScore: number | null;
    engageScore: number | null;
    contentScore: number | null;
    diagnosisCode: string | null;
    siteRank: number | null;
    totalArticles: number | null;
    sessions: number | null;
    charCount: number | null;
    imageCount: number | null;
    expectedReadSeconds: number | null;
    avgEngagementSeconds: number | null;
    narrative: Ga4EvaluationNarrativeView | null;
    dataQuality: Json;
    periodStart: string | null;
    periodEnd: string | null;
    ga4DataFetchedAt: string | null;
    errorCode: string | null;
  }>;
}

export interface Ga4EvaluationMetricSnapshot {
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number | null;
  engagementRate: number | null;
  activeUsers: number | null;
  cvEventCount: number;
  scroll90EventCount: number | null;
}

export interface Ga4EvaluationDailyMetric {
  date: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number | null;
  engagementRate: number | null;
  activeUsers: number | null;
  cvEventCount: number;
  scroll90EventCount: number | null;
}

export interface Ga4EvaluationGscMetricSnapshot {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

interface Ga4EvaluationDataQuality {
  missingMetrics: readonly string[];
  partial: boolean;
  reasons: readonly string[];
}

export interface Ga4EvaluationContext {
  article: {
    id: string;
    url: string;
    title: string | null;
    charCount: number;
    imageCount: number | null;
    headings: readonly string[];
    publishedAt: string | null;
    updatedAt: string | null;
  };
  period: {
    startDate: string;
    endDate: string;
  };
  fetchedAt: {
    ga4: string | null;
    gsc: string | null;
  };
  ga4: {
    summary: Ga4EvaluationMetricSnapshot | null;
    daily: readonly Ga4EvaluationDailyMetric[];
  };
  gsc: {
    summary: Ga4EvaluationGscMetricSnapshot | null;
  };
  dataQuality: Ga4EvaluationDataQuality;
}
