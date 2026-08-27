import type {
  Ga4DashboardRankingItem,
  Ga4DashboardSummary,
  Ga4DashboardTimeseriesPoint,
} from '@/types/ga4';

/**
 * `/ga4-dashboard` の集計 RPC が返す行を画面用の型へ写す。
 *
 * 集計そのものは `get_ga4_dashboard_*`（`20260821000000` マイグレーション）が
 * DB 側で行う。PostgREST は bigint / numeric を状況により文字列で返すため、
 * ここで数値化と NULL の扱いを1か所に閉じ込める。
 *
 * `database.types.ts` の生成型は当てにしない。`returns table(...)` の列は
 * 実際には NULL を返しうるが、生成器は `read_rate: number` のように
 * `| null` を落とす（`ctr` / `title` / `annotation_id` も同様）。
 * RPC の戻り値を直接読むと NULL が型で見えないため、受け口を `unknown` にして
 * ここで明示的に判定する。
 *
 * BR-02: 読了率の NULL は「90%スクロールイベントが未計測」であり 0% ではない。
 * 0 で埋めないこと。
 */

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface Ga4DashboardSummaryRow {
  total_sessions: unknown;
  total_users: unknown;
  total_engagement_time_sec: unknown;
  total_cv_event_count: unknown;
  total_scroll_90_event_count: unknown;
  scroll_measured_users: unknown;
  total_search_clicks: unknown;
  total_impressions: unknown;
  has_sampled_data: unknown;
  has_partial_data: unknown;
  row_count: unknown;
}

export const EMPTY_GA4_DASHBOARD_SUMMARY: Ga4DashboardSummary = {
  totalSessions: 0,
  totalUsers: 0,
  avgEngagementTimeSec: 0,
  totalCvEventCount: 0,
  cvr: 0,
  avgReadRate: null,
  totalSearchClicks: 0,
  totalImpressions: 0,
  ctr: null,
  hasSampledData: false,
  hasPartialData: false,
};

export function mapGa4DashboardSummaryRow(
  row: Ga4DashboardSummaryRow | null | undefined
): Ga4DashboardSummary {
  if (!row || toNumber(row.row_count) === 0) {
    return EMPTY_GA4_DASHBOARD_SUMMARY;
  }
  const totalSessions = toNumber(row.total_sessions);
  const totalUsers = toNumber(row.total_users);
  const totalEngagementTimeSec = toNumber(row.total_engagement_time_sec);
  const totalCvEventCount = toNumber(row.total_cv_event_count);
  const totalScroll90EventCount = toNumber(row.total_scroll_90_event_count);
  const scrollMeasuredUsers = toNumber(row.scroll_measured_users);
  const totalSearchClicks = toNumber(row.total_search_clicks);
  const totalImpressions = toNumber(row.total_impressions);

  return {
    totalSessions,
    totalUsers,
    avgEngagementTimeSec: totalSessions > 0 ? totalEngagementTimeSec / totalSessions : 0,
    totalCvEventCount,
    cvr: totalUsers > 0 ? (totalCvEventCount / totalUsers) * 100 : 0,
    // 計測できた行が1つも無ければ未計測。0% と書かない（BR-02）
    avgReadRate:
      scrollMeasuredUsers > 0 ? (totalScroll90EventCount / scrollMeasuredUsers) * 100 : null,
    totalSearchClicks,
    totalImpressions,
    ctr: totalImpressions > 0 ? totalSearchClicks / totalImpressions : null,
    hasSampledData: Boolean(row.has_sampled_data),
    hasPartialData: Boolean(row.has_partial_data),
  };
}

export interface Ga4DashboardRankingRow {
  normalized_path: unknown;
  annotation_id: unknown;
  title: unknown;
  sessions: unknown;
  users: unknown;
  avg_engagement_time_sec: unknown;
  cv_event_count: unknown;
  cvr: unknown;
  read_rate: unknown;
  search_clicks: unknown;
  impressions: unknown;
  ctr: unknown;
  is_sampled: unknown;
  is_partial: unknown;
  total_count: unknown;
}

export function mapGa4DashboardRankingRows(
  rows: readonly Ga4DashboardRankingRow[] | null | undefined
): { items: Ga4DashboardRankingItem[]; totalCount: number } {
  const list = rows ?? [];
  const items = list.map(row => ({
    normalizedPath: String(row.normalized_path ?? ''),
    title: row.title === null || row.title === undefined ? null : String(row.title),
    annotationId:
      row.annotation_id === null || row.annotation_id === undefined
        ? null
        : String(row.annotation_id),
    sessions: toNumber(row.sessions),
    users: toNumber(row.users),
    avgEngagementTimeSec: toNumber(row.avg_engagement_time_sec),
    cvEventCount: toNumber(row.cv_event_count),
    cvr: toNumber(row.cvr),
    readRate: toNullableNumber(row.read_rate),
    searchClicks: toNumber(row.search_clicks),
    impressions: toNumber(row.impressions),
    ctr: toNullableNumber(row.ctr),
    isSampled: Boolean(row.is_sampled),
    isPartial: Boolean(row.is_partial),
  }));
  // total_count はどの行も同じ値。0件のときは総数も0
  const totalCount = list.length > 0 ? toNumber(list[0]!.total_count) : 0;
  return { items, totalCount };
}

export interface Ga4DashboardTimeseriesRow {
  date: unknown;
  sessions: unknown;
  users: unknown;
  avg_engagement_time_sec: unknown;
  cv_event_count: unknown;
  cvr: unknown;
  read_rate: unknown;
  search_clicks: unknown;
  impressions: unknown;
  ctr: unknown;
  is_sampled: unknown;
  is_partial: unknown;
}

export function mapGa4DashboardTimeseriesRows(
  rows: readonly Ga4DashboardTimeseriesRow[] | null | undefined
): Ga4DashboardTimeseriesPoint[] {
  return (rows ?? []).map(row => ({
    date: String(row.date ?? ''),
    sessions: toNumber(row.sessions),
    users: toNumber(row.users),
    avgEngagementTimeSec: toNumber(row.avg_engagement_time_sec),
    cvEventCount: toNumber(row.cv_event_count),
    cvr: toNumber(row.cvr),
    readRate: toNullableNumber(row.read_rate),
    searchClicks: toNumber(row.search_clicks),
    impressions: toNumber(row.impressions),
    ctr: toNullableNumber(row.ctr),
    isSampled: Boolean(row.is_sampled),
    isPartial: Boolean(row.is_partial),
  }));
}
