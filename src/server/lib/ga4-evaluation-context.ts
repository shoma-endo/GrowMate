import type { AnnotationRecord } from '@/types/annotation';
import type {
  Ga4EvaluationContext,
  Ga4EvaluationDailyMetric,
  Ga4EvaluationGscMetricSnapshot,
  Ga4EvaluationMetricSnapshot,
} from '@/types/ga4-evaluation';
import type {
  Ga4DailyMetricInput,
  Ga4PeriodMetricSummary,
} from '@/server/lib/ga4-metrics-aggregation';
import { GA4_EVALUATION_CONTENT_REDUCTION_BUDGET } from '@/lib/constants';

const MAX_DAILY_METRICS = 90;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export interface BuildGa4EvaluationContextInput {
  annotation: AnnotationRecord;
  startDate: string;
  endDate: string;
  ga4Summary: Ga4PeriodMetricSummary | null;
  ga4DailyMetrics: readonly (Ga4DailyMetricInput & { date: string })[];
  gscSummary: Ga4EvaluationGscMetricSnapshot | null;
  ga4FetchedAt: string | null;
  gscFetchedAt: string | null;
}

function requireArticleIdentity(annotation: AnnotationRecord): { id: string; url: string } {
  if (!annotation.id) {
    throw new Error('GA4評価Contextには記事IDが必要です');
  }
  const url = annotation.canonical_url?.trim();
  if (!url) {
    throw new Error('GA4評価Contextには記事URLが必要です');
  }
  return { id: annotation.id, url };
}

function reduceArticleContent(annotation: AnnotationRecord): {
  contentText: string | null;
  excerpt: string | null;
  partial: boolean;
} {
  const contentText = annotation.wp_content_text?.trim() || null;
  const excerpt = annotation.wp_excerpt?.trim() || null;
  const contentLength = (contentText?.length ?? 0) + (excerpt?.length ?? 0);

  if (contentLength <= GA4_EVALUATION_CONTENT_REDUCTION_BUDGET) {
    return { contentText, excerpt, partial: false };
  }
  if (excerpt && excerpt.length <= GA4_EVALUATION_CONTENT_REDUCTION_BUDGET) {
    return { contentText: null, excerpt, partial: true };
  }
  return { contentText: null, excerpt: null, partial: true };
}

function toMetricSnapshot(summary: Ga4PeriodMetricSummary): Ga4EvaluationMetricSnapshot {
  return {
    sessions: summary.sessions,
    users: summary.users,
    engagementTimeSec: summary.engagementTimeSec,
    bounceRate: summary.bounceRate,
    cvEventCount: summary.cvEventCount,
  };
}

function toDailyMetric(metric: Ga4DailyMetricInput & { date: string }): Ga4EvaluationDailyMetric {
  return {
    date: metric.date,
    sessions: metric.sessions,
    users: metric.users,
    engagementTimeSec: metric.engagementTimeSec,
    bounceRate: metric.sessions === 0 ? null : metric.bounceRate,
    cvEventCount: metric.cvEventCount,
  };
}

function isFreshWithin48Hours(periodEnd: string, fetchedAt: string | null): boolean | null {
  if (!fetchedAt) {
    return null;
  }
  const periodEndTime = Date.parse(`${periodEnd}T23:59:59.999Z`);
  const fetchedTime = Date.parse(fetchedAt);
  if (!Number.isFinite(periodEndTime) || !Number.isFinite(fetchedTime)) {
    throw new Error('GA4評価Contextの日時が不正です');
  }
  const age = fetchedTime - periodEndTime;
  return age >= 0 && age <= FORTY_EIGHT_HOURS_MS;
}

export function buildGa4EvaluationContext(
  input: BuildGa4EvaluationContextInput
): Ga4EvaluationContext {
  if (!input.startDate || !input.endDate || input.startDate > input.endDate) {
    throw new Error('GA4評価Contextの対象期間が不正です');
  }

  const identity = requireArticleIdentity(input.annotation);
  const articleContent = reduceArticleContent(input.annotation);
  const daily = input.ga4DailyMetrics.slice(0, MAX_DAILY_METRICS).map(toDailyMetric);
  const partialDaily = input.ga4DailyMetrics.length > MAX_DAILY_METRICS;
  const missingMetrics: string[] = [];
  const reasons: string[] = [];

  if (!input.ga4Summary) {
    missingMetrics.push('ga4');
    reasons.push('ga4_summary_missing');
  } else if (input.ga4Summary.bounceRate === null) {
    missingMetrics.push('bounce_rate');
    reasons.push('bounce_rate_missing');
  }
  if (!input.gscSummary) {
    missingMetrics.push('gsc');
    reasons.push('gsc_summary_missing');
  }
  if (articleContent.partial) {
    reasons.push('article_content_reduced');
  }
  if (partialDaily) {
    reasons.push('ga4_daily_metrics_reduced');
  }

  return {
    article: {
      id: identity.id,
      url: identity.url,
      title: input.annotation.wp_post_title?.trim() || null,
      excerpt: articleContent.excerpt,
      contentText: articleContent.contentText,
    },
    period: { startDate: input.startDate, endDate: input.endDate },
    fetchedAt: { ga4: input.ga4FetchedAt, gsc: input.gscFetchedAt },
    freshness: {
      periodEndWithin48HoursOfGa4Fetch: isFreshWithin48Hours(input.endDate, input.ga4FetchedAt),
    },
    ga4: {
      summary: input.ga4Summary ? toMetricSnapshot(input.ga4Summary) : null,
      daily,
    },
    gsc: { summary: input.gscSummary },
    dataQuality: {
      missingMetrics,
      partial: articleContent.partial || partialDaily,
      reasons,
    },
  };
}
