export interface GoogleAdsEvaluationSettings {
  dateRangeDays: number;
  cronEnabled: boolean;
  lastEvaluatedOn: string | null;
}

export interface GoogleAdsEvaluationSettingsRecord extends GoogleAdsEvaluationSettings {
  userId: string;
  customerId: string;
  customerName: string | null;
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
