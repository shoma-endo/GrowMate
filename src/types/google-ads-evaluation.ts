/**
 * Google Ads AI 分析設定
 */
export interface GoogleAdsEvaluationSettings {
  /** 分析対象期間の日数。1 以上 365 以下の整数を使用する。例: 30 */
  dateRangeDays: number;
  /** 定期自動送信を有効化するかどうかのフラグ。 */
  cronEnabled: boolean;
  /** 最終成功実行日。`YYYY-MM-DD` 形式の JST 日付文字列、未実行時は null。 */
  lastEvaluatedOn: string | null;
}

export interface GoogleAdsEvaluationSettingsRecord extends GoogleAdsEvaluationSettings {
  userId: string;
  customerId: string;
  customerName: string | null;
  /** 連続エラー回数。0 以上の整数を保持する。 */
  consecutiveErrorCount: number;
  status: 'active' | 'paused';
}

export interface UpdateGoogleAdsEvaluationSettingsInput {
  dateRangeDays?: number;
  cronEnabled?: boolean;
}

export interface UpsertGoogleAdsEvaluationSettingsInput {
  userId: string;
  customerId: string;
  customerName?: string | null;
  dateRangeDays?: number;
  cronEnabled?: boolean;
  lastEvaluatedOn?: string | null;
  consecutiveErrorCount?: number;
  status?: 'active' | 'paused';
}

export interface GoogleAdsEvaluationQueueItem {
  userId: string;
  customerId: string;
  dateRangeDays: number;
  email: string;
}

export interface GoogleAdsAiAnalysisResult {
  success: boolean;
  skipped?: boolean;
  message?: string;
  error?: string;
}
