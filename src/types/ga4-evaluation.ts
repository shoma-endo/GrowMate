const GA4_PERSISTENT_EVALUATION_STATUSES = [
  'evaluated',
  'insufficient_data',
  'import_failed',
  'evaluation_failed',
  'evaluating',
] as const;

export type Ga4PersistentEvaluationStatus =
  (typeof GA4_PERSISTENT_EVALUATION_STATUSES)[number];

const GA4_EVALUATION_DISPLAY_STATUSES = [
  'evaluation_disabled',
  'unassessed',
  'eligible',
  'needs_reauth',
  ...GA4_PERSISTENT_EVALUATION_STATUSES,
] as const;

export type Ga4EvaluationDisplayStatus = (typeof GA4_EVALUATION_DISPLAY_STATUSES)[number];

export type Ga4EvaluationErrorCode =
  | 'needs_reauth'
  | 'evaluation_stale'
  | 'ga4_api_error'
  | 'gsc_api_error'
  | 'llm_rate_limited'
  | 'llm_server_error'
  | 'llm_timeout'
  | 'llm_output_invalid'
  | 'unknown';

interface Ga4EvaluationSuccessSnapshot {
  historyId: string;
  evaluatedAt: string;
}

export interface Ga4EvaluationProjection {
  status: Ga4PersistentEvaluationStatus;
  lastSuccess: Ga4EvaluationSuccessSnapshot | null;
  lastErrorCode: Ga4EvaluationErrorCode | null;
}

export interface Ga4EvaluationMetricSnapshot {
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number | null;
  cvEventCount: number;
}

export interface Ga4EvaluationDailyMetric {
  date: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number | null;
  cvEventCount: number;
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
    excerpt: string | null;
    contentText: string | null;
  };
  period: {
    startDate: string;
    endDate: string;
  };
  fetchedAt: {
    ga4: string | null;
    gsc: string | null;
  };
  freshness: {
    periodEndWithin48HoursOfGa4Fetch: boolean | null;
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
