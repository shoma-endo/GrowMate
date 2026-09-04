/**
 * 行選択のスコープを判定するためのキーを組み立てる。
 * 一覧の中身が入れ替わるフィルタ変更で選択を解除するために使う。
 * 実装メモ `docs/plans/analytics-bulk-actions-impl-note.md` §3.1「行チェックの選択スコープ」。
 *
 * ページ番号はキーに含めない。「前へ」「次へ」でページを移動しても選択は保持する
 * （2026-09-03 PO 指示。全選択はもともとページ非依存で、行チェックだけがページ送りで
 * 消えるのは非対称だった）。
 * GA4 集計期間は一覧の行そのものを入れ替えないためキーに含めない。
 */
export interface AnalyticsListingScope {
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  hasUnstartedGscEvaluation: boolean;
  hasUnsummarized: boolean;
}

export function buildListingSelectionKey(scope: AnalyticsListingScope): string {
  return JSON.stringify([
    [...scope.selectedCategoryNames].sort(),
    scope.includeUncategorized,
    scope.hasUnreadSuggestion,
    scope.hasUnstartedGscEvaluation,
    scope.hasUnsummarized,
  ]);
}
