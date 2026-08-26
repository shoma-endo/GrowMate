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
    // 未計測のとき集計値は 0 になるが、評価入力の記録物としては 0（実測0回）と
    // 区別できる形で残す（日次側と同じ扱い。BR-02）
    scroll90EventCount: summary.scrollMetricsAvailable ? summary.scroll90EventCount : null,
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
