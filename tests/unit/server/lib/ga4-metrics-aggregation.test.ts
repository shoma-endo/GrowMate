import { describe, expect, it } from 'vitest';

import {
  aggregateGa4EvaluationPageMetrics,
  aggregateGa4PageMetrics,
  toDisplayedGa4PageMetricSummary,
  type Ga4DailyMetricInput,
} from '@/server/lib/ga4-metrics-aggregation';

const baseMetric: Ga4DailyMetricInput = {
  normalizedPath: '/articles/one',
  sessions: 2,
  users: 3,
  engagementTimeSec: 20,
  bounceRate: 0.25,
  engagementRate: 0.4,
  activeUsers: 4,
  cvEventCount: 1,
  scroll90EventCount: 2,
  searchClicks: 3,
  impressions: 10,
  isSampled: false,
  isPartial: false,
};

describe('ga4-metrics-aggregation', () => {
  it('path単位で日次値を合算し、直帰率をセッション加重平均・CTRを再計算する', () => {
    const result = aggregateGa4PageMetrics(
      [
        baseMetric,
        {
          ...baseMetric,
          sessions: 8,
          users: 7,
          engagementTimeSec: 80,
          bounceRate: 0.75,
          cvEventCount: 4,
          scroll90EventCount: 8,
          searchClicks: 2,
          impressions: 10,
          isSampled: true,
          isPartial: true,
        },
      ],
      '2026-08-01',
      '2026-08-08'
    );

    expect(result.get('/articles/one')).toEqual({
      normalizedPath: '/articles/one',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-08',
      sessions: 10,
      users: 10,
      engagementTimeSec: 100,
      bounceRate: 0.65,
      engagementRate: 0.4,
      activeUsers: 8,
      cvEventCount: 5,
      scroll90EventCount: 10,
      scrollMetricsAvailable: true,
      searchClicks: 5,
      impressions: 20,
      ctr: 0.25,
      isSampled: true,
      isPartial: true,
    });
  });

  it('分母0の直帰率は欠損として保持し、一覧表示時だけ0へ写像する', () => {
    const summary = aggregateGa4PageMetrics(
      [{ ...baseMetric, sessions: 0, impressions: 0 }],
      '2026-08-01',
      '2026-08-08'
    ).get('/articles/one');

    expect(summary?.bounceRate).toBeNull();
    expect(summary?.ctr).toBeNull();
    expect(summary).toBeDefined();
    expect(toDisplayedGa4PageMetricSummary(summary!)).toMatchObject({ bounceRate: 0, ctr: null });
  });

  it('評価入力では期間内の必須指標欠損をnullと部分取得として伝播する', () => {
    const summary = aggregateGa4EvaluationPageMetrics([
      { ...baseMetric, sessions: 10, engagementRate: 0.2, activeUsers: 5 },
      { ...baseMetric, sessions: 10, engagementRate: null, activeUsers: null },
      { ...baseMetric, sessions: 20, engagementRate: 0.8, activeUsers: 7 },
    ], '2026-08-01', '2026-08-03').get('/articles/one');
    expect(summary?.engagementRate).toBeNull();
    expect(summary?.activeUsers).toBeNull();
    expect(summary?.isPartial).toBe(true);
  });
});
