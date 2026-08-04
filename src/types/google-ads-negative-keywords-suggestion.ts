export interface GoogleAdsNegativeKeywordsSuggestionSettings {
  enabled: boolean;
  sendHourJst: number;
  /** 送信成功日（JST）。UI の「最終送信日」表示に使う */
  lastSentOn: string | null;
  /** 直近の配信試行日（JST）。成功・失敗を問わず更新し、cron の同日重複実行を防ぐ */
  lastAttemptedOn: string | null;
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
  /** 時間予算超過で打ち切った場合のみ設定される */
  stoppedReason?: 'time_limit';
  /** 時間予算超過により当該実行で処理しなかったユーザー数 */
  skippedDueToLimit?: number;
}
