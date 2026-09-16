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

  // 期間は「未指定＝全期間」。既定の直近30日が投稿を黙って隠していたため 2026-09-16 に変更した。
  // URL に空の ig_start が生えると、そこから組み立てた次の href で不正な絞り込みになる。
  it('期間が未指定（null）なら ig_start / ig_end を出力しない', () => {
    const href = buildInstagramHref(buildState({ igStart: null, igEnd: null }), {
      tab: 'instagram',
    });
    expect(href).not.toContain('ig_start');
    expect(href).not.toContain('ig_end');
    expect(href).toContain('tab=instagram');
  });

  it('patch で空文字を渡したら絞り込み解除として扱い、state の期間に落とさない', () => {
    const href = buildInstagramHref(buildState(), { tab: 'instagram', igStart: '', igEnd: '' });
    expect(href).not.toContain('ig_start');
    expect(href).not.toContain('ig_end');
  });

  it('片側だけの指定なら、その側だけ出力する', () => {
    const href = buildInstagramHref(buildState({ igEnd: null }), { tab: 'instagram' });
    expect(href).toContain('ig_start=2026-08-01');
    expect(href).not.toContain('ig_end');
  });

  it('patch で片側だけ解除しても、もう片側は state から残る', () => {
    const href = buildInstagramHref(buildState(), { tab: 'instagram', igEnd: '' });
    expect(href).toContain('ig_start=2026-08-01');
    expect(href).not.toContain('ig_end');
  });

  it('ブログ側へ切り替える patch でも期間の解除が効く（分岐の非対称検知）', () => {
    const href = buildInstagramHref(buildState({ activeTab: 'instagram' }), {
      tab: 'blog',
      igStart: '',
      igEnd: '',
    });
    expect(href).not.toContain('ig_start');
    expect(href).not.toContain('ig_end');
  });

  it('タブをブログへ切り替えても、指定済みの期間は維持する', () => {
    const href = buildInstagramHref(buildState({ activeTab: 'instagram' }), { tab: 'blog' });
    expect(href).toContain('ig_start=2026-08-01');
    expect(href).toContain('ig_end=2026-08-25');
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
