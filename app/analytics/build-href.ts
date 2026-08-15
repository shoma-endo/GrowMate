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
  instagramConnected: boolean;
  activeTab: 'blog' | 'instagram';
  igPage: number;
  igType: InstagramMediaTypeFilter;
  igStart: string;
  igEnd: string;
  igSort: InstagramMediaSortKey;
}

export interface InstagramHrefPatch {
  tab?: 'blog' | 'instagram';
  igPage?: number;
  igType?: InstagramMediaTypeFilter;
  igStart?: string;
  igEnd?: string;
  igSort?: InstagramMediaSortKey;
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

  const nextTab = patch.tab ?? state.activeTab;
  if (state.instagramConnected && nextTab === 'instagram') {
    query.set('tab', 'instagram');
    query.set('ig_page', String(patch.igPage ?? state.igPage));
    query.set('ig_type', patch.igType ?? state.igType);
    query.set('ig_start', patch.igStart ?? state.igStart);
    query.set('ig_end', patch.igEnd ?? state.igEnd);
    query.set('ig_sort', patch.igSort ?? state.igSort);
  }
  if (patch.tab === 'instagram') {
    query.set('ig_page', '1');
  }
  if (patch.tab === 'blog') {
    query.set('page', '1');
    query.set('ig_page', String(state.igPage));
    query.set('ig_type', state.igType);
    query.set('ig_start', state.igStart);
    query.set('ig_end', state.igEnd);
    query.set('ig_sort', state.igSort);
  }

  return `/analytics?${query.toString()}`;
}

export function buildIgPageHref(state: AnalyticsHrefState, targetIgPage: number): string {
  return buildInstagramHref(state, { igPage: targetIgPage });
}

export interface InstagramFilterPatch {
  igType?: InstagramMediaTypeFilter;
  igStart?: string;
  igEnd?: string;
  igSort?: InstagramMediaSortKey;
  igPage?: number;
}

export function buildIgFilterHref(state: AnalyticsHrefState, patch: InstagramFilterPatch): string {
  return buildInstagramHref(state, { tab: 'instagram', ...patch });
}
