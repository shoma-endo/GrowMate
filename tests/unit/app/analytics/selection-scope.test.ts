import { describe, expect, it } from 'vitest';
import {
  buildListingSelectionKey,
  type AnalyticsListingScope,
} from '@/../app/analytics/selection-scope';

const baseScope: AnalyticsListingScope = {
  currentPage: 1,
  selectedCategoryNames: [],
  includeUncategorized: false,
  hasUnreadSuggestion: false,
  hasUnstartedGscEvaluation: false,
  hasUnsummarized: false,
};

describe('buildListingSelectionKey', () => {
  it('同じ一覧条件なら同じキーになる', () => {
    expect(buildListingSelectionKey(baseScope)).toBe(buildListingSelectionKey({ ...baseScope }));
  });

  it('ページが変わるとキーが変わる', () => {
    expect(buildListingSelectionKey({ ...baseScope, currentPage: 2 })).not.toBe(
      buildListingSelectionKey(baseScope)
    );
  });

  it('1ページ目のままでもフィルタが変わるとキーが変わる', () => {
    const key = buildListingSelectionKey(baseScope);
    expect(buildListingSelectionKey({ ...baseScope, selectedCategoryNames: ['SEO'] })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, includeUncategorized: true })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, hasUnreadSuggestion: true })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, hasUnstartedGscEvaluation: true })).not.toBe(
      key
    );
  });

  it('カテゴリの指定順が違うだけならキーは変わらない', () => {
    expect(
      buildListingSelectionKey({ ...baseScope, selectedCategoryNames: ['SEO', 'AI'] })
    ).toBe(buildListingSelectionKey({ ...baseScope, selectedCategoryNames: ['AI', 'SEO'] }));
  });

  it('入力のカテゴリ配列を破壊しない', () => {
    const selectedCategoryNames = ['SEO', 'AI'];
    buildListingSelectionKey({ ...baseScope, selectedCategoryNames });
    expect(selectedCategoryNames).toEqual(['SEO', 'AI']);
  });
});
