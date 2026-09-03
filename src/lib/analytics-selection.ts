/**
 * コンテンツ一覧の一括選択の状態を解く。
 *
 * 全選択（`isSelectAll`）の母集団はフィルタ非依存の全記事で、その ID はクライアントに無い
 * （`docs/plans/gsc-bulk-evaluation-start-spec.md` BR-07）。そのため全選択中の個別解除は
 * 「全選択を解除して選び直す」のではなく **除外集合 `excludedIds` に足す**ことで表す。
 * 解除してしまうと、表示中のページ以外の選択を復元する手立てが無い。
 */
export interface AnalyticsSelectionState {
  /** 全選択していないときに選ばれている記事 */
  selectedIds: ReadonlySet<string>;
  /** 全選択中に個別解除された記事。`isSelectAll` が false のときは意味を持たない */
  excludedIds: ReadonlySet<string>;
  isSelectAll: boolean;
}

/** 集合に id が含まれる状態を `shouldContain` へ揃えた新しい集合を返す */
export function toggleIdMembership(
  source: ReadonlySet<string>,
  id: string,
  shouldContain: boolean
): Set<string> {
  const next = new Set(source);
  if (shouldContain) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

/** 行のチェックが ON か */
export function resolveRowChecked(state: AnalyticsSelectionState, annotationId: string): boolean {
  return state.isSelectAll
    ? !state.excludedIds.has(annotationId)
    : state.selectedIds.has(annotationId);
}

/** ヘッダの全選択チェックの状態。一部だけ選ばれていれば indeterminate */
export function resolveHeaderChecked(
  state: AnalyticsSelectionState
): boolean | 'indeterminate' {
  if (state.isSelectAll) {
    return state.excludedIds.size > 0 ? 'indeterminate' : true;
  }
  return state.selectedIds.size > 0 ? 'indeterminate' : false;
}

/**
 * 選択件数（上限で丸める前の生の件数）。
 * 全選択中は母集団の件数から除外分を差し引く。母集団の件数が取れていないときは 0。
 */
export function resolveRawSelectedCount(
  state: AnalyticsSelectionState,
  populationTotal: number | null
): number {
  if (!state.isSelectAll) return state.selectedIds.size;
  return Math.max(0, (populationTotal ?? 0) - state.excludedIds.size);
}
