/**
 * GA4集計の純関数
 *
 * 日次行から期間サマリーを作る集計（`aggregateGa4*`）と、
 * ダッシュボードの集計RPCが返す行を画面用の型へ写す写像（`mapGa4Dashboard*`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 集計 / 評価 / 表示」であってモジュール名ではないため、
 * その単位でまとめている。どのモジュールの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateGa4EvaluationPageMetrics,
  aggregateGa4PageMetrics,
  toDisplayedGa4PageMetricSummary,
  type Ga4DailyMetricInput,
} from '@/server/lib/ga4-metrics-aggregation';
import {
  EMPTY_GA4_DASHBOARD_SUMMARY,
  mapGa4DashboardRankingRows,
  mapGa4DashboardSummaryRow,
  mapGa4DashboardTimeseriesRows,
  type Ga4DashboardRankingRow,
  type Ga4DashboardSummaryRow,
} from '@/server/lib/ga4-dashboard-mapping';

describe('@/server/lib/ga4-metrics-aggregation', () => {
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

    it('評価入力では期間内に1日でも未計測のスクロールがあれば取得不可として扱う', () => {
      const summary = aggregateGa4EvaluationPageMetrics([
        { ...baseMetric, sessions: 10, scroll90EventCount: 5 },
        { ...baseMetric, sessions: 10, scroll90EventCount: null },
      ], '2026-08-01', '2026-08-02').get('/articles/one');

      // 一部の日だけを分子に期間全体のセッションを分母にすると完読率を過小評価するため、
      // 全か無かで落とす（engagementRate / activeUsers と同じ方針）
      expect(summary?.scrollMetricsAvailable).toBe(false);
    });

    it('スクロールが全日実測されていれば取得可能として扱う（実測0回はnullにしない）', () => {
      const summary = aggregateGa4EvaluationPageMetrics([
        { ...baseMetric, sessions: 10, scroll90EventCount: 0 },
        { ...baseMetric, sessions: 10, scroll90EventCount: 0 },
      ], '2026-08-01', '2026-08-02').get('/articles/one');

      expect(summary?.scrollMetricsAvailable).toBe(true);
      expect(summary?.scroll90EventCount).toBe(0);
    });
  });
});

describe('@/server/lib/ga4-dashboard-mapping', () => {
  const summaryRow = (overrides: Partial<Ga4DashboardSummaryRow> = {}): Ga4DashboardSummaryRow => ({
    total_sessions: 100,
    total_users: 80,
    total_engagement_time_sec: 4000,
    total_cv_event_count: 8,
    total_scroll_90_event_count: 20,
    scroll_measured_users: 40,
    total_search_clicks: 10,
    total_impressions: 500,
    has_sampled_data: false,
    has_partial_data: false,
    row_count: 30,
    ...overrides,
  });

  const rankingRow = (overrides: Partial<Ga4DashboardRankingRow> = {}): Ga4DashboardRankingRow => ({
    normalized_path: '/a',
    annotation_id: null,
    title: null,
    sessions: 10,
    users: 10,
    avg_engagement_time_sec: 40,
    cv_event_count: 0,
    cvr: 0,
    read_rate: 25,
    search_clicks: 0,
    impressions: 0,
    ctr: null,
    is_sampled: false,
    is_partial: false,
    total_count: 3,
    ...overrides,
  });

  describe('mapGa4DashboardSummaryRow', () => {
    it('行が無いときは空のサマリーを返す', () => {
      expect(mapGa4DashboardSummaryRow(null)).toEqual(EMPTY_GA4_DASHBOARD_SUMMARY);
      expect(mapGa4DashboardSummaryRow(summaryRow({ row_count: 0 }))).toEqual(
        EMPTY_GA4_DASHBOARD_SUMMARY
      );
    });

    it('空のサマリーの読了率は 0% ではなく未計測（null）', () => {
      // 0% と書くと「実測して誰も読み切らなかった」と読めてしまう（BR-02）
      expect(EMPTY_GA4_DASHBOARD_SUMMARY.avgReadRate).toBeNull();
    });

    it('計測できた行のユーザーだけを読了率の分母にする', () => {
      // 全80ユーザーではなく、スクロールを計測できた40ユーザーで割る
      const summary = mapGa4DashboardSummaryRow(summaryRow());
      expect(summary.avgReadRate).toBeCloseTo(50, 10);
    });

    it('計測できた行が1つも無ければ読了率は null', () => {
      const summary = mapGa4DashboardSummaryRow(
        summaryRow({ scroll_measured_users: 0, total_scroll_90_event_count: 0 })
      );
      expect(summary.avgReadRate).toBeNull();
    });

    it('PostgREST が数値を文字列で返しても解釈する', () => {
      const summary = mapGa4DashboardSummaryRow(
        summaryRow({ total_sessions: '100', total_engagement_time_sec: '4000' })
      );
      expect(summary.totalSessions).toBe(100);
      expect(summary.avgEngagementTimeSec).toBe(40);
    });

    it('分母が0のとき平均・CVRは0、CTRは null', () => {
      const summary = mapGa4DashboardSummaryRow(
        summaryRow({ total_sessions: 0, total_users: 0, total_impressions: 0 })
      );
      expect(summary.avgEngagementTimeSec).toBe(0);
      expect(summary.cvr).toBe(0);
      expect(summary.ctr).toBeNull();
    });
  });

  describe('mapGa4DashboardRankingRows', () => {
    it('総件数を先頭行から取り、0件なら0にする', () => {
      expect(mapGa4DashboardRankingRows([rankingRow(), rankingRow()]).totalCount).toBe(3);
      expect(mapGa4DashboardRankingRows([]).totalCount).toBe(0);
      expect(mapGa4DashboardRankingRows(null).totalCount).toBe(0);
    });

    it('読了率の未計測（null）を0にしない', () => {
      const { items } = mapGa4DashboardRankingRows([rankingRow({ read_rate: null })]);
      expect(items[0]?.readRate).toBeNull();
    });

    it('実測0はそのまま0として扱う', () => {
      const { items } = mapGa4DashboardRankingRows([rankingRow({ read_rate: 0 })]);
      expect(items[0]?.readRate).toBe(0);
    });

    it('記事に紐づかないパスは annotationId と title が null', () => {
      const { items } = mapGa4DashboardRankingRows([rankingRow()]);
      expect(items[0]?.annotationId).toBeNull();
      expect(items[0]?.title).toBeNull();
    });

    it('紐づいた記事の情報を写す', () => {
      const { items } = mapGa4DashboardRankingRows([
        rankingRow({ annotation_id: 'abc', title: '記事タイトル' }),
      ]);
      expect(items[0]?.annotationId).toBe('abc');
      expect(items[0]?.title).toBe('記事タイトル');
    });
  });

  describe('mapGa4DashboardTimeseriesRows', () => {
    it('日付と指標を写し、未計測の読了率は null のまま', () => {
      const points = mapGa4DashboardTimeseriesRows([
        {
          date: '2026-08-19',
          sessions: 5,
          users: 5,
          avg_engagement_time_sec: 12.5,
          cv_event_count: 1,
          cvr: 20,
          read_rate: null,
          search_clicks: 0,
          impressions: 0,
          ctr: null,
          is_sampled: false,
          is_partial: true,
        },
      ]);
      expect(points).toHaveLength(1);
      expect(points[0]?.date).toBe('2026-08-19');
      expect(points[0]?.avgEngagementTimeSec).toBe(12.5);
      expect(points[0]?.readRate).toBeNull();
      expect(points[0]?.isPartial).toBe(true);
    });

    it('空配列・null を空配列として扱う', () => {
      expect(mapGa4DashboardTimeseriesRows([])).toEqual([]);
      expect(mapGa4DashboardTimeseriesRows(null)).toEqual([]);
    });
  });
});
