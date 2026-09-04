import { describe, expect, it } from 'vitest';
import {
  buildListingSelectionKey,
  type AnalyticsListingScope,
} from '@/../app/analytics/selection-scope';

const baseScope: AnalyticsListingScope = {
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

  it('フィルタが変わるとキーが変わる', () => {
    const key = buildListingSelectionKey(baseScope);
    expect(buildListingSelectionKey({ ...baseScope, selectedCategoryNames: ['SEO'] })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, includeUncategorized: true })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, hasUnreadSuggestion: true })).not.toBe(key);
    expect(buildListingSelectionKey({ ...baseScope, hasUnstartedGscEvaluation: true })).not.toBe(
      key
    );
  });

  it('未要約フィルタが変わるとキーが変わる', () => {
    expect(buildListingSelectionKey({ ...baseScope, hasUnsummarized: true })).not.toBe(
      buildListingSelectionKey(baseScope)
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
