export type GscPropertyType = 'sc-domain' | 'url-prefix';

export interface GscCredential {
  id: string;
  userId: string;
  googleAccountEmail?: string | null;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  scope?: string[] | null;
  propertyUri?: string | null;
  propertyType?: GscPropertyType | null;
  propertyDisplayName?: string | null;
  permissionLevel?: string | null;
  verified?: boolean | null;
  lastSyncedAt?: string | null;
  ga4PropertyId?: string | null;
  ga4PropertyName?: string | null;
  ga4ConversionEvents?: string[] | null;
  ga4ThresholdEngagementSec?: number | null;
  ga4ThresholdReadRate?: number | null;
  ga4LastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GscConnectionStatus {
  connected: boolean;
  needsReauth?: boolean;
  googleAccountEmail?: string | null;
  propertyUri?: string | null;
  propertyDisplayName?: string | null;
  propertyType?: GscPropertyType | null;
  permissionLevel?: string | null;
  verified?: boolean | null;
  lastSyncedAt?: string | null;
  updatedAt?: string | null;
  scope?: string[] | null;
}

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
  propertyType: GscPropertyType;
  displayName: string;
  verified: boolean;
}

export type GscSearchType = 'web' | 'image' | 'news' | 'video';

export interface GscPageMetric {
  id: string;
  userId: string;
  contentAnnotationId?: string | null;
  propertyUri: string;
  searchType: GscSearchType;
  date: string; // ISO date (YYYY-MM-DD)
  url: string;
  normalizedUrl?: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  importedAt: string;
}

export interface GscQueryMetric {
  id: string;
  userId: string;
  propertyUri: string;
  propertyType: GscPropertyType;
  searchType: GscSearchType;
  date: string;
  url: string;
  normalizedUrl: string;
  query: string;
  queryNormalized: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  contentAnnotationId?: string | null;
  importedAt: string;
}

export type GscEvaluationStage = 1 | 2 | 3 | 4;
export type GscEvaluationStatus = 'active' | 'paused' | 'completed';
export type GscEvaluationOutcome = 'improved' | 'no_change' | 'worse';
export type GscEvaluationOutcomeType = 'success' | 'error';
export type GscEvaluationErrorCode = 'import_failed' | 'no_metrics';

export type GscImportResult = {
  totalFetched: number;
  upserted: number;
  skipped: number;
  unmatched: number;
  evaluated: number;
  pageMetricsHitLimit: boolean;
  segmentCount?: number;
  querySummary?: {
    fetchedRows: number;
    keptRows: number;
    dedupedRows: number;
    fetchErrorPages: number;
    skipped: {
      missingKeys: number;
      invalidUrl: number;
      emptyQuery: number;
      zeroMetrics: number;
    };
    hitLimit: boolean;
  };
};

export interface GscImportOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  searchType?: GscSearchType;
  maxRows?: number;
  runEvaluation?: boolean;
}

export interface GscSearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryMetricInsert {
  userId: string;
  propertyUri: string;
  propertyType: GscPropertyType;
  searchType: GscSearchType;
  date: string;
  url: string;
  normalizedUrl: string;
  query: string;
  queryNormalized: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  contentAnnotationId?: string | null;
  importedAt: string;
}

export interface GscArticleEvaluation {
  id: string;
  userId: string;
  contentAnnotationId: string;
  propertyUri: string;
  currentSuggestionStage: number; // 1-4
  lastEvaluatedOn?: string | null; // ISO date
  baseEvaluationDate: string; // ISO date
  cycleDays: number;
  evaluationHour: number;
  lastSeenPosition?: number | null;
  status: GscEvaluationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GscArticleEvaluationHistory {
  id: string;
  userId: string;
  contentAnnotationId: string;
  evaluationDate: string; // ISO date
  previousPosition?: number | null;
  currentPosition?: number | null; // nullable for errors
  outcome?: GscEvaluationOutcome | null; // nullable for errors
  outcomeType: GscEvaluationOutcomeType; // 'success' or 'error'
  errorCode?: GscEvaluationErrorCode | null;
  errorMessage?: string | null;
  suggestionApplied: boolean;
  suggestionSummary?: string | null;
  isRead?: boolean;
  createdAt: string;
}

export const GSC_EVALUATION_OUTCOME_CONFIG: Record<
  GscEvaluationOutcome,
  {
    label: string;
    badgeVariant: 'success' | 'secondary' | 'destructive';
    className: string;
  }
> = {
  improved: {
    label: '改善',
    badgeVariant: 'success',
    className: 'bg-green-50 text-green-700 ring-green-600/20',
  },
  no_change: {
    label: '変化なし',
    badgeVariant: 'secondary',
    className: 'bg-gray-50 text-gray-700 ring-gray-500/10',
  },
  worse: {
    label: '悪化',
    badgeVariant: 'destructive',
    className: 'bg-red-50 text-red-700 ring-red-600/20',
  },
} as const;

export interface EvaluationResultSummary {
  processed: number;
  improved: number;
  advanced: number;
  skippedNoMetrics: number;
  skippedImportFailed: number;
  skippedSystemError: number;
}

export interface BatchResultSummary {
  usersProcessed: number;
  usersAttempted: number;
  usersSkippedDueToLimit: number;
  stoppedReason: 'completed' | 'time_limit' | 'max_users';
  totalEvaluations: number;
  totalImproved: number;
  totalAdvanced: number;
  totalSkipped: number;
  totalImportFailed: number;
  totalSystemError: number;
  errors: string[];
}

export interface GscEvaluationRow {
  id: string;
  user_id: string;
  content_annotation_id: string;
  property_uri: string;
  current_suggestion_stage?: number | null;
  last_evaluated_on?: string | null;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour: number;
  last_seen_position?: number | null;
  status: string;
}

export interface RunEvaluationOptions {
  /** true の場合、評価期限チェックをスキップして全評価対象を処理（手動実行用） */
  force?: boolean;
  /** 特定の記事のみ手動評価する場合に指定 */
  contentAnnotationId?: string;
  /** すでに取得済みの評価レコードを渡す場合に使用（再フェッチを避ける） */
  evaluations?: GscEvaluationRow[];
  /** 既に取得した現在のJST日時を渡す場合に使用（バッチと同じ基準時刻で判定するため） */
  nowJst?: Date;
  /** バッチ処理全体の開始時刻（タイムアウト判定用） */
  startTime?: number;
}
