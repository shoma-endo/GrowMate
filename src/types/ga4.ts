export interface Ga4PropertySummary {
  propertyId: string;
  displayName: string;
  accountId?: string | null;
  accountName?: string | null;
}

export interface Ga4KeyEvent {
  name: string;
  eventName: string;
}

export type Ga4ConnectionStage = 'unlinked' | 'linked_unselected' | 'configured';

export interface Ga4ConnectionStatus {
  connected: boolean;
  connectionStage: Ga4ConnectionStage;
  needsReauth?: boolean;
  scopeMissing?: boolean;
  googleAccountEmail?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
  conversionEvents?: string[] | null;
  thresholdEngagementSec?: number | null;
  thresholdReadRate?: number | null;
  lastSyncedAt?: string | null;
  updatedAt?: string | null;
}

export interface Ga4PageMetricSummary {
  normalizedPath: string;
  dateFrom: string;
  dateTo: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number; // 0-1
  cvEventCount: number;
  scroll90EventCount: number;
  isSampled: boolean;
  isPartial: boolean;
}

export interface Ga4DailyMetricRow {
  userId: string;
  propertyId: string;
  date: string;
  pagePath: string;
  normalizedPath: string;
  sessions: number;
  users: number;
  engagementTimeSec: number;
  bounceRate: number;
  cvEventCount: number;
  scroll90EventCount: number;
  isSampled: boolean;
  isPartial: boolean;
  importedAt: string;
}

// GA4 Dashboard用型定義
export interface Ga4DashboardSummary {
  totalSessions: number;
  totalUsers: number;
  avgEngagementTimeSec: number;
  avgBounceRate: number; // 0-1
  totalCvEventCount: number;
  cvr: number; // 0-100
  avgReadRate: number; // 0-100
  hasSampledData: boolean;
  hasPartialData: boolean;
}

export interface Ga4DashboardRankingItem {
  normalizedPath: string;
  title?: string | null;
  annotationId?: string | null;
  sessions: number;
  users: number;
  avgEngagementTimeSec: number;
  bounceRate: number; // 0-1
  cvEventCount: number;
  cvr: number; // 0-100
  readRate: number; // 0-100
  isSampled: boolean;
  isPartial: boolean;
}

export interface Ga4DashboardTimeseriesPoint {
  date: string;
  sessions: number;
  users: number;
  avgEngagementTimeSec: number;
  bounceRate: number; // 0-1
  cvEventCount: number;
  cvr: number; // 0-100
  readRate: number; // 0-100
  isSampled: boolean;
  isPartial: boolean;
}

export interface Ga4DashboardChartData {
  summary: Ga4DashboardSummary;
  ranking: Ga4DashboardRankingItem[];
  timeseries: Ga4DashboardTimeseriesPoint[];
}

export type Ga4DashboardSortKey =
  | 'sessions'
  | 'cvr'
  | 'readRate'
  | 'avgEngagementTimeSec';

export type Ga4DashboardTimeSeriesMetric =
  | 'sessions'
  | 'users'
  | 'readRate'
  | 'bounceRate'
  | 'cvr';
