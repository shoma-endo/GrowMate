import {
  ANALYTICS_CONTENT_SORT_KEYS,
  type AnalyticsContentSort,
  type AnalyticsContentSortKey,
} from '@/types/analytics';

/**
 * ブログ一覧（/analytics）の列見出しによる並べ替え。URL の `sort` / `order` が正本で、
 * localStorage には保存しない（画面を開き直すと更新日の新しい順に戻る）。
 * Instagram タブ（`ig_sort` / `ig_order`）とは別のパラメータで、互いに影響しない。
 */

export function isAnalyticsSortKey(raw: string): raw is AnalyticsContentSortKey {
  return (ANALYTICS_CONTENT_SORT_KEYS as readonly string[]).includes(raw);
}

/**
 * URL の値を解釈する。**許可値以外は並べ替えなしへ畳む。**
 * 解釈せずに RPC へ流すと、壊れた値がサーバーのクエリに乗る。
 */
export function parseAnalyticsSort(
  rawSort: string | null | undefined,
  rawOrder: string | null | undefined
): AnalyticsContentSort {
  if (typeof rawSort !== 'string' || !isAnalyticsSortKey(rawSort)) return null;
  return { key: rawSort, order: rawOrder === 'asc' ? 'asc' : 'desc' };
}

/**
 * 列見出しを押したときの次の状態。別の列なら降順（多い順）から始め、
 * 同じ列は 降順 → 昇順 → 並べ替えなし（更新日の新しい順）と巡る。
 */
export function nextAnalyticsSort(
  current: AnalyticsContentSort,
  clicked: AnalyticsContentSortKey
): AnalyticsContentSort {
  if (current === null || current.key !== clicked) return { key: clicked, order: 'desc' };
  if (current.order === 'desc') return { key: clicked, order: 'asc' };
  return null;
}

/**
 * `sort` / `order` を URL に書く。並べ替えなしなら両方消す。
 * ページ送り（page.tsx）・期間変更・タブ切替・列見出しの全経路で同じ規則を使う。
 */
export function setAnalyticsSortParams(query: URLSearchParams, sort: AnalyticsContentSort) {
  if (sort === null) {
    query.delete('sort');
    query.delete('order');
    return;
  }
  query.set('sort', sort.key);
  query.set('order', sort.order);
}
