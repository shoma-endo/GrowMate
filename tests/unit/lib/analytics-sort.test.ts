import { describe, expect, it } from 'vitest';

import {
  nextAnalyticsSort,
  parseAnalyticsSort,
  setAnalyticsSortParams,
} from '@/lib/analytics-sort';
import { ANALYTICS_COLUMNS } from '@/lib/constants';
import { ANALYTICS_CONTENT_SORT_KEYS } from '@/types/analytics';

describe('parseAnalyticsSort', () => {
  it('許可された列だけを受け付け、向きは asc 以外を降順に畳む', () => {
    expect(parseAnalyticsSort('ga4_cvr', 'asc')).toEqual({ key: 'ga4_cvr', order: 'asc' });
    expect(parseAnalyticsSort('ga4_cvr', 'desc')).toEqual({ key: 'ga4_cvr', order: 'desc' });
    expect(parseAnalyticsSort('ga4_cvr', 'bogus')).toEqual({ key: 'ga4_cvr', order: 'desc' });
    expect(parseAnalyticsSort('ga4_cvr', undefined)).toEqual({ key: 'ga4_cvr', order: 'desc' });
  });

  it('許可外・未指定の列は並べ替えなしにする（RPC へ壊れた値を流さない）', () => {
    expect(parseAnalyticsSort('ga4_diagnosis', 'asc')).toBeNull();
    expect(parseAnalyticsSort('updated_at; drop table', 'asc')).toBeNull();
    expect(parseAnalyticsSort(undefined, 'asc')).toBeNull();
    expect(parseAnalyticsSort(null, null)).toBeNull();
  });
});

describe('nextAnalyticsSort', () => {
  it('同じ列は 降順 → 昇順 → 並べ替えなし と巡る', () => {
    const first = nextAnalyticsSort(null, 'impressions');
    expect(first).toEqual({ key: 'impressions', order: 'desc' });
    const second = nextAnalyticsSort(first, 'impressions');
    expect(second).toEqual({ key: 'impressions', order: 'asc' });
    expect(nextAnalyticsSort(second, 'impressions')).toBeNull();
  });

  it('別の列を押したら降順から始める', () => {
    expect(nextAnalyticsSort({ key: 'impressions', order: 'asc' }, 'ga4_cv_count')).toEqual({
      key: 'ga4_cv_count',
      order: 'desc',
    });
  });
});

describe('setAnalyticsSortParams', () => {
  it('並べ替え中は sort / order を書き、並べ替えなしなら両方消す', () => {
    const query = new URLSearchParams('page=3&sort=impressions&order=asc&category=a');
    setAnalyticsSortParams(query, { key: 'ga4_content_score', order: 'desc' });
    expect(query.get('sort')).toBe('ga4_content_score');
    expect(query.get('order')).toBe('desc');

    setAnalyticsSortParams(query, null);
    expect(query.has('sort')).toBe(false);
    expect(query.has('order')).toBe(false);
    // 他の条件は触らない
    expect(query.get('page')).toBe('3');
    expect(query.get('category')).toBe('a');
  });
});

describe('ANALYTICS_CONTENT_SORT_KEYS', () => {
  it('並べ替えできる列はすべて一覧の列として存在する（見出しが押せない列を作らない）', () => {
    const columnIds = new Set(ANALYTICS_COLUMNS.map(column => column.id));
    for (const key of ANALYTICS_CONTENT_SORT_KEYS) {
      expect(columnIds.has(key)).toBe(true);
    }
  });
});
