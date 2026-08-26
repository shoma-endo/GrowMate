import type { Ga4PageMetricSummary } from '@/types/ga4';

export interface Ga4DailyMetricInput {
  normalizedPath: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number;
  engagementRate: number | null;
  activeUsers: number | null;
  cvEventCount: number;
  scroll90EventCount: number | null;
  searchClicks: number;
  impressions: number;
  isSampled: boolean;
  isPartial: boolean;
}

export interface Ga4PeriodMetricSummary {
  normalizedPath: string;
  dateFrom: string;
  dateTo: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number | null;
  engagementRate: number | null;
  activeUsers: number | null;
  cvEventCount: number;
  scroll90EventCount: number;
  scrollMetricsAvailable: boolean;
  searchClicks: number;
  impressions: number;
  ctr: number | null;
  isSampled: boolean;
  isPartial: boolean;
}

interface MutableGa4PeriodMetricSummary {
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRateWeighted: number;
  bounceRateSessions: number;
  engagementRateWeighted: number;
  engagementRateSessions: number;
  activeUsers: number | null;
  cvEventCount: number;
  scroll90EventCount: number;
  scrollMetricsAvailable: boolean;
  searchClicks: number;
  impressions: number;
  isSampled: boolean;
  isPartial: boolean;
}

export function aggregateGa4PageMetrics(
  rows: readonly Ga4DailyMetricInput[],
  startDate: string,
  endDate: string
): Map<string, Ga4PeriodMetricSummary> {
  const aggregates = new Map<string, MutableGa4PeriodMetricSummary>();

  for (const row of rows) {
    const current = aggregates.get(row.normalizedPath) ?? {
      sessions: 0,
      users: 0,
      engagementTimeSec: 0,
      bounceRateWeighted: 0,
      bounceRateSessions: 0,
      engagementRateWeighted: 0,
      engagementRateSessions: 0,
      activeUsers: null,
      cvEventCount: 0,
      scroll90EventCount: 0,
      scrollMetricsAvailable: false,
      searchClicks: 0,
      impressions: 0,
      isSampled: false,
      isPartial: false,
    };

    current.sessions += row.sessions;
    current.users += row.users;
    current.engagementTimeSec += row.engagementTimeSec;
    current.cvEventCount += row.cvEventCount;
    if (row.scroll90EventCount !== null) {
      current.scroll90EventCount += row.scroll90EventCount;
      current.scrollMetricsAvailable = true;
    }
    current.searchClicks += row.searchClicks;
    current.impressions += row.impressions;
    current.bounceRateWeighted += row.bounceRate * row.sessions;
    current.bounceRateSessions += row.sessions;
    if (row.engagementRate !== null) {
      current.engagementRateWeighted += row.engagementRate * row.sessions;
      current.engagementRateSessions += row.sessions;
    }
    if (row.activeUsers !== null) {
      current.activeUsers = (current.activeUsers ?? 0) + row.activeUsers;
    }
    current.isSampled ||= row.isSampled;
    current.isPartial ||= row.isPartial;

    aggregates.set(row.normalizedPath, current);
  }

  // 完読率は「期間内に1日でも未計測（null）があれば取得不可」で扱う（レビュー🔴4）。
  // 分子だけを実測日に限りながら分母は全日を足すと、薄まった完読率になる。
  // 20260819000300 が実測0を null 化して以降は、未計測の日が常に混じりうる。
  // 評価パス（aggregateGa4EvaluationPageMetrics）と同じ意味にしておかないと、
  // 同じ記事・同じ期間の完読率が一覧・ダッシュボード・記事詳細で食い違う。
  const partiallyMeasuredScrollPaths = new Set(
    rows.filter(row => row.scroll90EventCount === null).map(row => row.normalizedPath)
  );

  return new Map(
    Array.from(aggregates, ([normalizedPath, aggregate]) => [normalizedPath, {
      normalizedPath,
      dateFrom: startDate,
      dateTo: endDate,
      sessions: aggregate.sessions,
      users: aggregate.users,
      engagementTimeSec: aggregate.engagementTimeSec,
      bounceRate:
        aggregate.bounceRateSessions > 0
          ? aggregate.bounceRateWeighted / aggregate.bounceRateSessions
          : null,
      engagementRate:
        aggregate.engagementRateSessions > 0
          ? aggregate.engagementRateWeighted / aggregate.engagementRateSessions
          : null,
      activeUsers: aggregate.activeUsers,
      cvEventCount: aggregate.cvEventCount,
      scroll90EventCount: aggregate.scroll90EventCount,
      scrollMetricsAvailable:
        aggregate.scrollMetricsAvailable && !partiallyMeasuredScrollPaths.has(normalizedPath),
      searchClicks: aggregate.searchClicks,
      impressions: aggregate.impressions,
      ctr: aggregate.impressions > 0 ? aggregate.searchClicks / aggregate.impressions : null,
      isSampled: aggregate.isSampled,
      isPartial: aggregate.isPartial,
    }])
  );
}

export function aggregateGa4EvaluationPageMetrics(
  rows: readonly Ga4DailyMetricInput[],
  startDate: string,
  endDate: string
): Map<string, Ga4PeriodMetricSummary> {
  const summaries = aggregateGa4PageMetrics(rows, startDate, endDate);
  const missingEngagementRatePaths = new Set(
    rows.filter(row => row.engagementRate === null).map(row => row.normalizedPath)
  );
  const missingActiveUsersPaths = new Set(
    rows.filter(row => row.activeUsers === null).map(row => row.normalizedPath)
  );
  // 完読率の全か無かは aggregateGa4PageMetrics 側へ移した（レビュー🔴4。一覧も同じ意味に
  // 揃えるため）。ここは engagementRate / activeUsers 用の後処理が主で、
  // missingScrollPaths は冗長だが冪等なので残す（意図を読み取れる形を優先）。
  const missingScrollPaths = new Set(
    rows.filter(row => row.scroll90EventCount === null).map(row => row.normalizedPath)
  );

  return new Map(
    Array.from(summaries, ([normalizedPath, summary]) => [normalizedPath, {
      ...summary,
      engagementRate: missingEngagementRatePaths.has(normalizedPath) ? null : summary.engagementRate,
      activeUsers: missingActiveUsersPaths.has(normalizedPath) ? null : summary.activeUsers,
      scrollMetricsAvailable: missingScrollPaths.has(normalizedPath)
        ? false
        : summary.scrollMetricsAvailable,
      isPartial:
        summary.isPartial ||
        missingEngagementRatePaths.has(normalizedPath) ||
        missingActiveUsersPaths.has(normalizedPath),
    }])
  );
}

export function toDisplayedGa4PageMetricSummary(
  summary: Ga4PeriodMetricSummary
): Ga4PageMetricSummary {
  return {
    ...summary,
    bounceRate: summary.bounceRate ?? 0,
  };
}
