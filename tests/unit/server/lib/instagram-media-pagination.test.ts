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
  it('複数ページを連結する（最終ページに paging が無ければ nextCursor は null＝アカウント末端）', () => {
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
    expect(result.nextCursor).toBeNull();
  });

  it('cursor が欠落したら次ページを辿らない（nextCursor も null）', () => {
    const result = collectInstagramMediaPages(
      [{ data: [{ id: '1' }] }, { data: [{ id: '2' }] }],
      50
    );

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.pagesFetched).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it('空ページで打ち切る（nextCursor は null＝アカウント末端）', () => {
    const result = collectInstagramMediaPages(
      [{ data: [{ id: '1' }], paging: { cursors: { after: 'page-2' } } }, { data: [] }],
      50
    );

    expect(result.items).toEqual([{ id: '1' }]);
    expect(result.pagesFetched).toBe(2);
    expect(result.nextCursor).toBeNull();
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

  it('途中まで完全に取り込んだページの後続カーソルが nextCursor に残る（末端未到達）', () => {
    const result = collectInstagramMediaPages(
      [{ data: [{ id: '1' }, { id: '2' }], paging: { cursors: { after: 'page-2' } } }],
      50
    );

    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBe('page-2');
  });

  it('truncated したページ自体に paging があれば、その位置からの再開カーソルを nextCursor に返す', () => {
    const result = collectInstagramMediaPages(
      [
        {
          data: [{ id: '1' }, { id: '2' }, { id: '3' }],
          paging: { cursors: { after: 'page-2' } },
        },
      ],
      2
    );

    expect(result.items).toEqual([{ id: '1' }, { id: '2' }]);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBe('page-2');
  });
});
