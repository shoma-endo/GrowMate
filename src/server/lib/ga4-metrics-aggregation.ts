import type { Ga4PageMetricSummary } from '@/types/ga4';

export interface Ga4DailyMetricInput {
  normalizedPath: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number;
  cvEventCount: number;
  scroll90EventCount: number;
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
  cvEventCount: number;
  scroll90EventCount: number;
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
  cvEventCount: number;
  scroll90EventCount: number;
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
      cvEventCount: 0,
      scroll90EventCount: 0,
      searchClicks: 0,
      impressions: 0,
      isSampled: false,
      isPartial: false,
    };

    current.sessions += row.sessions;
    current.users += row.users;
    current.engagementTimeSec += row.engagementTimeSec;
    current.cvEventCount += row.cvEventCount;
    current.scroll90EventCount += row.scroll90EventCount;
    current.searchClicks += row.searchClicks;
    current.impressions += row.impressions;
    current.bounceRateWeighted += row.bounceRate * row.sessions;
    current.bounceRateSessions += row.sessions;
    current.isSampled ||= row.isSampled;
    current.isPartial ||= row.isPartial;

    aggregates.set(row.normalizedPath, current);
  }

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
      cvEventCount: aggregate.cvEventCount,
      scroll90EventCount: aggregate.scroll90EventCount,
      searchClicks: aggregate.searchClicks,
      impressions: aggregate.impressions,
      ctr: aggregate.impressions > 0 ? aggregate.searchClicks / aggregate.impressions : null,
      isSampled: aggregate.isSampled,
      isPartial: aggregate.isPartial,
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
