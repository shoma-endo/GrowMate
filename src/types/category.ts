/**
 * カテゴリフィルター設定（localStorage用）
 */
export interface CategoryFilterConfig {
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
}

/**
 * 状態フィルター設定（localStorage用）。
 * カテゴリとは別キーで持つ。URL の `unread_suggestion` / `gsc_evaluation=not_started` /
 * `unsummarized` と 1:1 で対応する。
 */
export interface StatusFilterConfig {
  unreadSuggestion: boolean;
  unstartedGscEvaluation: boolean;
  unsummarized: boolean;
}
