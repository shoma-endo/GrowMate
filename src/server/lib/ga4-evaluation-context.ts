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
import { countContentChars } from '@/lib/content-text';
import { extractHeadingsFromMarkdown } from '@/lib/heading-extractor';

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
  ga4MetricsTruncated?: boolean;
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

function toMetricSnapshot(summary: Ga4PeriodMetricSummary): Ga4EvaluationMetricSnapshot {
  return {
    sessions: summary.sessions,
    users: summary.users,
    engagementTimeSec: summary.engagementTimeSec,
    bounceRate: summary.bounceRate,
    engagementRate: summary.engagementRate,
    activeUsers: summary.activeUsers,
    cvEventCount: summary.cvEventCount,
    scroll90EventCount: summary.scroll90EventCount,
  };
}

function toDailyMetric(metric: Ga4DailyMetricInput & { date: string }): Ga4EvaluationDailyMetric {
  return {
    date: metric.date,
    sessions: metric.sessions,
    users: metric.users,
    engagementTimeSec: metric.engagementTimeSec,
    bounceRate: metric.sessions === 0 ? null : metric.bounceRate,
    engagementRate: metric.engagementRate,
    activeUsers: metric.activeUsers,
    cvEventCount: metric.cvEventCount,
    scroll90EventCount: metric.scroll90EventCount,
  };
}

function isFreshWithin48Hours(periodEnd: string, fetchedAt: string | null): boolean | null {
  if (!fetchedAt) {
    return null;
  }
  const periodEndTime = Date.parse(`${periodEnd}T00:00:00.000Z`);
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
  const daily = input.ga4DailyMetrics.slice(0, MAX_DAILY_METRICS).map(toDailyMetric);
  const partialDaily = input.ga4DailyMetrics.length > MAX_DAILY_METRICS;
  const missingMetrics: string[] = [];
  const reasons: string[] = [];

  if (!input.ga4Summary) {
    missingMetrics.push('ga4');
    reasons.push('ga4_summary_missing');
  } else {
    if (input.ga4Summary.bounceRate === null) {
      missingMetrics.push('bounce_rate');
      reasons.push('bounce_rate_missing');
    }
    if (input.ga4Summary.engagementRate === null) {
      missingMetrics.push('engagement_rate');
      reasons.push('engagement_rate_missing');
    }
    if (input.ga4Summary.activeUsers === null) {
      missingMetrics.push('active_users');
      reasons.push('active_users_missing');
    }
    if (input.ga4Summary.scrollMetricsAvailable === false) {
      missingMetrics.push('scroll_90_event_count');
      reasons.push('scroll_90_event_count_missing');
    }
  }
  if (partialDaily || input.ga4MetricsTruncated === true) {
    reasons.push('ga4_daily_metrics_reduced');
  }

  return {
    article: {
      id: identity.id,
      url: identity.url,
      title: input.annotation.wp_post_title?.trim() || null,
      charCount: countContentChars(input.annotation.wp_content_text),
      imageCount: input.annotation.wp_image_count ?? null,
      headings: extractHeadingsFromMarkdown(input.annotation.basic_structure ?? '')
        .filter(heading => heading.level === 2)
        .slice(0, 10)
        .map(heading => heading.text),
      publishedAt: input.annotation.created_at ?? null,
      updatedAt: input.annotation.updated_at ?? null,
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
      partial: missingMetrics.length > 0 || partialDaily || input.ga4MetricsTruncated === true || input.annotation.wp_image_count === null || input.annotation.wp_image_count === undefined,
      reasons,
    },
  };
}
