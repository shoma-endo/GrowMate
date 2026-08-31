/**
 * 行選択のスコープ（表示中ページ内）を判定するためのキーを組み立てる。
 * ページ送りだけでなく、一覧の中身が入れ替わるフィルタ変更でも選択を解除するために使う。
 * 実装メモ `docs/plans/analytics-bulk-actions-impl-note.md` §3.1「行チェックの選択スコープ」。
 *
 * GA4 集計期間は一覧の行そのものを入れ替えないためキーに含めない。
 */
export interface AnalyticsListingScope {
  currentPage: number;
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  hasUnstartedGscEvaluation: boolean;
}

export function buildListingSelectionKey(scope: AnalyticsListingScope): string {
  return JSON.stringify([
    scope.currentPage,
    [...scope.selectedCategoryNames].sort(),
    scope.includeUncategorized,
    scope.hasUnreadSuggestion,
    scope.hasUnstartedGscEvaluation,
  ]);
}
