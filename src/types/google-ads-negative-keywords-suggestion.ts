export interface GoogleAdsNegativeKeywordsSuggestionSettings {
  enabled: boolean;
  sendHourJst: number;
  lastSentOn: string | null;
  lastSendError: string | null;
}

export interface GoogleAdsNegativeKeywordsSuggestionSettingsRecord
  extends GoogleAdsNegativeKeywordsSuggestionSettings {
  userId: string;
}

export interface UpsertGoogleAdsNegativeKeywordsSuggestionSettingsInput {
  userId: string;
  enabled?: boolean;
  sendHourJst?: number;
  lastSentOn?: string | null;
  lastSendError?: string | null;
}

export interface GoogleAdsNegativeKeywordsSuggestionResult {
  success: boolean;
  message?: string;
  error?: string;
  skipped?: boolean;
}

export interface GoogleAdsNegativeKeywordsSuggestionBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}
