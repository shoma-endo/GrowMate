import { describe, expect, it } from 'vitest';

import { buildInstagramHref, type AnalyticsHrefState } from '@/../app/analytics/build-href';

// 一覧の状態フィルタは 2026-08-26 のサイクル統合で「評価未設定」1つになった
// （フェーズ3で足した「コンテンツ評価未開始」＝ `ga4_evaluation` を撤回し、develop と同じ構成へ戻した）。
// build-href.ts は副作用ゼロの純関数なのにテストが無く、次に誰かが
// `hasUnstartedGscEvaluation` を消し忘れる／消しすぎる余地があったため新設する。
function buildState(overrides: Partial<AnalyticsHrefState> = {}): AnalyticsHrefState {
  return {
    currentPage: 1,
    selectedCategoryNames: [],
    includeUncategorized: false,
    hasUnreadSuggestion: false,
    hasUnstartedGscEvaluation: false,
    hasUnsummarized: false,
    instagramConnected: true,
    activeTab: 'blog',
    igPage: 1,
    igType: 'all',
    igStart: '2026-08-01',
    igEnd: '2026-08-25',
    igSort: 'posted_at',
    ...overrides,
  };
}

describe('buildInstagramHref', () => {
  it('「評価未設定」フィルタはタブを切り替えても維持される', () => {
    const href = buildInstagramHref(buildState({ hasUnstartedGscEvaluation: true }), {
      tab: 'instagram',
    });
    expect(href).toContain('gsc_evaluation=not_started');
  });

  it('廃止した ga4_evaluation は決して出力しない（統合の回帰防止）', () => {
    const href = buildInstagramHref(
      buildState({ hasUnstartedGscEvaluation: true, hasUnreadSuggestion: true }),
      { tab: 'instagram' }
    );
    expect(href).not.toContain('ga4_evaluation');
  });

  it('フィルタが全て false なら状態クエリを一切付けない', () => {
    const href = buildInstagramHref(buildState(), { tab: 'blog' });
    expect(href).not.toContain('gsc_evaluation');
    expect(href).not.toContain('unread_suggestion');
    expect(href).not.toContain('uncategorized');
    expect(href).not.toContain('category=');
  });

  it('カテゴリは append で複数回出力する（set への退行検知）', () => {
    const href = buildInstagramHref(
      buildState({ selectedCategoryNames: ['SEO', '広告運用'] }),
      { tab: 'blog' }
    );
    const categories = [...new URL(href, 'https://example.test').searchParams.getAll('category')];
    expect(categories).toEqual(['SEO', '広告運用']);
  });
});
