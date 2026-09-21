import type { InstagramMediaSortKey, InstagramMediaTypeFilter } from '@/types/instagram';

/**
 * /analytics の URL 組み立てに必要な状態。
 * Server Component（page.tsx）・Client Component（AnalyticsClient.tsx）の両方から
 * 同じロジックで href を計算するための共有関数。
 * RSC は関数を Client Component へ props で渡せない（"use server" 以外）ため、
 * 関数ではなくこの状態オブジェクト（シリアライズ可能な値のみ）を props でやり取りし、
 * href が必要な側でこの関数を都度呼び出す。
 */
export interface AnalyticsHrefState {
  currentPage: number;
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  hasUnstartedGscEvaluation: boolean;
  hasUnsummarized: boolean;
  instagramConnected: boolean;
  activeTab: 'blog' | 'instagram';
  igPage: number;
  igType: InstagramMediaTypeFilter;
  /** null / 空文字は絞り込みなし。URL にも出さない */
  igStart: string | null;
  /** null / 空文字は絞り込みなし。URL にも出さない */
  igEnd: string | null;
  igSort: InstagramMediaSortKey;
  igHigh: boolean;
}

export interface InstagramHrefPatch {
  tab?: 'blog' | 'instagram';
  igPage?: number;
  igType?: InstagramMediaTypeFilter;
  igStart?: string | null;
  igEnd?: string | null;
  igSort?: InstagramMediaSortKey;
  igHigh?: boolean;
}

/**
 * 期間は未指定なら URL に載せない。日付入力を空にしたときは空文字で来るのでそれも未指定扱い。
 * page.tsx の buildPageHref も同じ規則で組み立てる必要があるため export する
 * （片方だけ直すと、ページ送りだけ絞り込みが残る／消えるという食い違いが出る）。
 */
export function setOptionalDate(
  query: URLSearchParams,
  key: string,
  value: string | null | undefined
) {
  if (typeof value === 'string' && value.length > 0) {
    query.set(key, value);
  }
}

export function buildInstagramHref(state: AnalyticsHrefState, patch: InstagramHrefPatch): string {
  const query = new URLSearchParams();
  query.set('page', String(state.currentPage));
  for (const categoryName of state.selectedCategoryNames) {
    const trimmed = categoryName.trim();
    if (trimmed.length > 0) {
      query.append('category', trimmed);
    }
  }
  if (state.includeUncategorized) {
    query.set('uncategorized', '1');
  }
  if (state.hasUnreadSuggestion) {
    query.set('unread_suggestion', '1');
  }
  if (state.hasUnstartedGscEvaluation) {
    query.set('gsc_evaluation', 'not_started');
  }
  if (state.hasUnsummarized) {
    query.set('unsummarized', '1');
  }

  const nextTab = patch.tab ?? state.activeTab;
  // patch で明示的に null / '' が来たら「絞り込み解除」なので ?? で state に落とさない。
  // 1度だけ解決して両分岐で使う（blog 分岐だけ state を見ていると解除が効かない）
  const nextIgStart = patch.igStart !== undefined ? patch.igStart : state.igStart;
  const nextIgEnd = patch.igEnd !== undefined ? patch.igEnd : state.igEnd;
  const nextIgHigh = patch.igHigh !== undefined ? patch.igHigh : state.igHigh;

  if (state.instagramConnected && nextTab === 'instagram') {
    query.set('tab', 'instagram');
    query.set('ig_page', String(patch.igPage ?? state.igPage));
    query.set('ig_type', patch.igType ?? state.igType);
    setOptionalDate(query, 'ig_start', nextIgStart);
    setOptionalDate(query, 'ig_end', nextIgEnd);
    query.set('ig_sort', patch.igSort ?? state.igSort);
    query.set('ig_high', nextIgHigh ? '1' : '0');
  }
  if (patch.tab === 'instagram') {
    query.set('ig_page', '1');
  }
  if (patch.tab === 'blog') {
    query.set('page', '1');
    query.set('ig_page', String(state.igPage));
    query.set('ig_type', state.igType);
    setOptionalDate(query, 'ig_start', nextIgStart);
    setOptionalDate(query, 'ig_end', nextIgEnd);
    query.set('ig_sort', state.igSort);
    query.set('ig_high', nextIgHigh ? '1' : '0');
  }

  return `/analytics?${query.toString()}`;
}

export function buildIgPageHref(state: AnalyticsHrefState, targetIgPage: number): string {
  return buildInstagramHref(state, { igPage: targetIgPage });
}

export interface InstagramFilterPatch {
  igType?: InstagramMediaTypeFilter;
  igStart?: string | null;
  igEnd?: string | null;
  igSort?: InstagramMediaSortKey;
  igHigh?: boolean;
  igPage?: number;
}

export function buildIgFilterHref(state: AnalyticsHrefState, patch: InstagramFilterPatch): string {
  return buildInstagramHref(state, { tab: 'instagram', ...patch });
}
