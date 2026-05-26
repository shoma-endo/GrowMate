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

export interface StructuredNegativeKeywordSuggestion {
  suggestionId: string;
  searchTerm: string;
  level: 'campaign' | 'ad_group';
  category: 'company' | 'knowhow' | 'general_phrase';
  urgency: 'click_occurred' | 'preventive' | 'review_needed';
  campaignName?: string;
  adGroupName?: string;
  matchType?: string;
  reason?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  conversions?: number;
}
