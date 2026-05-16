/**
 * Google Ads AI 分析設定
 */
export interface GoogleAdsEvaluationSettings {
  /** 分析対象期間の日数。1 以上 365 以下の整数を使用する。例: 30 */
  dateRangeDays: number;
  /** 最終成功実行日。`YYYY-MM-DD` 形式の JST 日付文字列、未実行時は null。 */
  lastEvaluatedOn: string | null;
}

export interface GoogleAdsEvaluationSettingsRecord extends GoogleAdsEvaluationSettings {
  userId: string;
}

export interface UpdateGoogleAdsEvaluationSettingsInput {
  dateRangeDays?: number;
}

export interface UpsertGoogleAdsEvaluationSettingsInput {
  userId: string;
  dateRangeDays?: number;
  lastEvaluatedOn?: string | null;
}

export interface GoogleAdsAiAnalysisResult {
  success: boolean;
  message?: string;
  error?: string;
}
