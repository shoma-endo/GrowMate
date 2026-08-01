import { describe, expect, it } from 'vitest';

import {
  collectInstagramMediaPages,
  extractInstagramMediaAfterCursor,
} from '@/server/lib/instagram-media-pagination';

describe('extractInstagramMediaAfterCursor', () => {
  it('paging.cursors.after を返す', () => {
    expect(
      extractInstagramMediaAfterCursor({
        cursors: { after: 'cursor-abc' },
      })
    ).toBe('cursor-abc');
  });

  it('cursor が欠落しているとき null を返す', () => {
    expect(extractInstagramMediaAfterCursor({})).toBeNull();
    expect(extractInstagramMediaAfterCursor(null)).toBeNull();
    expect(extractInstagramMediaAfterCursor({ cursors: { after: '' } })).toBeNull();
  });
});

describe('collectInstagramMediaPages', () => {
  it('複数ページを連結する', () => {
    const result = collectInstagramMediaPages(
      [
        { data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } },
        { data: [{ id: '3' }] },
      ],
      50
    );

    expect(result.items).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(result.truncated).toBe(false);
    expect(result.pagesFetched).toBe(2);
  });

  it('cursor が欠落したら次ページを辿らない', () => {
    const result = collectInstagramMediaPages(
      [{ data: [{ id: '1' }] }, { data: [{ id: '2' }] }],
      50
    );

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.pagesFetched).toBe(1);
  });

  it('空ページで打ち切る', () => {
    const result = collectInstagramMediaPages(
      [{ data: [{ id: '1' }], paging: { cursors: { after: 'page-2' } } }, { data: [] }],
      50
    );

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.pagesFetched).toBe(2);
  });

  it('maxItems 到達で truncated=true になる', () => {
    const result = collectInstagramMediaPages(
      [
        { data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } },
        { data: [{ id: '3' }, { id: '4' }] },
      ],
      3
    );

    expect(result.items).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(result.truncated).toBe(true);
    expect(result.pagesFetched).toBe(2);
  });
});
