import { describe, expect, it, vi } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import {
  chunkRows,
  groupByReadScope,
  isSameAtScale,
  selectChangedRows,
  upsertSplittingOnTimeout,
} from '@/server/lib/gsc-metrics-upsert';

const timeout = { code: '57014', message: 'canceling statement due to statement timeout' } as PostgrestError;

describe('isSameAtScale', () => {
  it('列の桁に丸めて同じ値になるなら同じとみなす', () => {
    expect(isSameAtScale(0.333333, 0.3333, 4)).toBe(true);
    expect(isSameAtScale(3.456, 3.46, 2)).toBe(true);
  });

  it('丸めると別の値になるなら変わったとみなす', () => {
    expect(isSameAtScale(0.3334, 0.3333, 4)).toBe(false);
    expect(isSameAtScale(3.47, 3.46, 2)).toBe(false);
  });

  it('丸めの境界ちょうどは DB と同じく 0 から遠い方へ丸めて比べる', () => {
    expect(isSameAtScale(0.03125, 0.0313, 4)).toBe(true);
    expect(isSameAtScale(8.125, 8.13, 2)).toBe(true);
    expect(isSameAtScale(3.465, 3.47, 2)).toBe(true);
    expect(isSameAtScale(3.465, 3.46, 2)).toBe(false);
  });
});

describe('selectChangedRows', () => {
  type Row = { key: string | null; value: number };
  const select = (incoming: Row[], existing: Row[]) =>
    selectChangedRows(incoming, existing, row => row.key, row => row.key, (row, stored) => row.value === stored.value);

  it('値が同じ行は返さない', () => {
    expect(select([{ key: 'a', value: 1 }], [{ key: 'a', value: 1 }])).toEqual([]);
  });

  it('新規行と値が変わった行だけを返す', () => {
    expect(
      select(
        [
          { key: 'same', value: 1 },
          { key: 'changed', value: 3 },
          { key: 'new', value: 4 },
        ],
        [
          { key: 'same', value: 1 },
          { key: 'changed', value: 2 },
        ]
      )
    ).toEqual([
      { key: 'changed', value: 3 },
      { key: 'new', value: 4 },
    ]);
  });

  it('キーが null の行は突き合わせられないので書く', () => {
    expect(select([{ key: null, value: 1 }], [{ key: null, value: 1 }])).toEqual([{ key: null, value: 1 }]);
  });
});

describe('groupByReadScope', () => {
  const scopeOf = (row: { date: string }) => ({ userId: 'u', propertyUri: 'p', searchType: 'web', date: row.date });

  it('URL が1つだけなら期間全体を1回で読む', () => {
    const groups = groupByReadScope(
      [
        { date: '2026-10-03', url: 'example.com/a' },
        { date: '2026-10-01', url: 'example.com/a' },
        { date: '2026-10-02', url: 'example.com/a' },
      ],
      scopeOf,
      row => row.url
    );

    expect(groups.map(group => [group.scope.dateFrom, group.scope.dateTo, group.scope.normalizedUrl, group.rows.length])).toEqual([
      ['2026-10-01', '2026-10-03', 'example.com/a', 3],
    ]);
  });

  it('複数の URL を含むなら日ごとに読む', () => {
    const groups = groupByReadScope(
      [
        { date: '2026-10-01', url: 'example.com/a' },
        { date: '2026-10-01', url: 'example.com/b' },
        { date: '2026-10-02', url: 'example.com/a' },
      ],
      scopeOf,
      row => row.url
    );

    expect(groups.map(group => [group.scope.dateFrom, group.scope.dateTo, group.scope.normalizedUrl, group.rows.length])).toEqual([
      ['2026-10-01', '2026-10-01', null, 2],
      ['2026-10-02', '2026-10-02', null, 1],
    ]);
  });
});

describe('chunkRows', () => {
  it('既定で200件ずつに分ける', () => {
    expect(chunkRows(Array.from({ length: 450 }, (_, i) => i)).map(chunk => chunk.length)).toEqual([200, 200, 50]);
  });
});

describe('upsertSplittingOnTimeout', () => {
  it('57014 のときは半分に割って書き直す', async () => {
    const upsert = vi.fn(async (chunk: number[]) => ({ error: chunk.length > 100 ? timeout : null }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await upsertSplittingOnTimeout(Array.from({ length: 200 }, (_, i) => i), upsert);

    expect(result).toEqual({ written: 200, error: null });
    expect(upsert.mock.calls.map(([chunk]) => chunk.length)).toEqual([200, 100, 100]);
  });

  it('下限まで割っても 57014 ならエラーを返し、残りは書かない', async () => {
    const upsert = vi.fn(async (_chunk: number[]) => ({ error: timeout }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await upsertSplittingOnTimeout(Array.from({ length: 200 }, (_, i) => i), upsert, 25);

    expect(result).toEqual({ written: 0, error: timeout });
    expect(upsert.mock.calls.map(([chunk]) => chunk.length)).toEqual([200, 100, 50, 25]);
  });

  it('57014 以外のエラーは割らずに返す', async () => {
    const otherError = { code: '23505', message: 'duplicate key' } as PostgrestError;
    const upsert = vi.fn(async () => ({ error: otherError }));

    const result = await upsertSplittingOnTimeout([1, 2, 3, 4], upsert, 1);

    expect(result).toEqual({ written: 0, error: otherError });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('左の下限チャンクが 57014 でも右半分の書ける行は書く', async () => {
    const upsert = vi.fn(async (chunk: number[]) => ({
      error: chunk.length > 25 || chunk[0] === 0 ? timeout : null,
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await upsertSplittingOnTimeout(Array.from({ length: 200 }, (_, i) => i), upsert);

    expect(result).toEqual({ written: 175, error: timeout });
  });
});
