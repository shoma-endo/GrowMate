import { describe, expect, it } from 'vitest';
import {
  resolveHeaderChecked,
  resolveRawSelectedCount,
  resolveRowChecked,
  toggleIdMembership,
} from '@/lib/analytics-selection';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('toggleIdMembership', () => {
  it('元の集合を変更せず新しい集合を返す', () => {
    const source = new Set([A]);
    const next = toggleIdMembership(source, B, true);
    expect(next).toEqual(new Set([A, B]));
    expect(source).toEqual(new Set([A]));
  });

  it('shouldContain が false なら取り除く', () => {
    expect(toggleIdMembership(new Set([A, B]), A, false)).toEqual(new Set([B]));
  });
});

describe('全選択中に1件だけ外す（BR-07「全選択後の個別解除」）', () => {
  const selectAll = { selectedIds: new Set<string>(), isSelectAll: true };

  it('外した記事だけチェックが消え、他の行は選ばれたまま', () => {
    const state = { ...selectAll, excludedIds: new Set([A]) };
    expect(resolveRowChecked(state, A)).toBe(false);
    expect(resolveRowChecked(state, B)).toBe(true);
  });

  it('ヘッダは indeterminate になる（全解除にならない）', () => {
    expect(resolveHeaderChecked({ ...selectAll, excludedIds: new Set([A]) })).toBe('indeterminate');
  });

  it('除外が無ければヘッダは checked のまま', () => {
    expect(resolveHeaderChecked({ ...selectAll, excludedIds: new Set() })).toBe(true);
  });

  it('選択件数は母集団から除外分を差し引く', () => {
    expect(resolveRawSelectedCount({ ...selectAll, excludedIds: new Set([A, B]) }, 24)).toBe(22);
  });

  it('全件を除外しても負にならない', () => {
    expect(resolveRawSelectedCount({ ...selectAll, excludedIds: new Set([A, B]) }, 1)).toBe(0);
  });

  it('母集団の件数が取れていなければ 0', () => {
    expect(resolveRawSelectedCount({ ...selectAll, excludedIds: new Set() }, null)).toBe(0);
  });
});

describe('全選択していないとき', () => {
  const state = { selectedIds: new Set([A]), excludedIds: new Set([B]), isSelectAll: false };

  it('excludedIds は行のチェック状態に影響しない', () => {
    expect(resolveRowChecked(state, A)).toBe(true);
    expect(resolveRowChecked(state, B)).toBe(false);
  });

  it('ヘッダは選択が1件以上あれば indeterminate、無ければ unchecked', () => {
    expect(resolveHeaderChecked(state)).toBe('indeterminate');
    expect(resolveHeaderChecked({ ...state, selectedIds: new Set() })).toBe(false);
  });

  it('選択件数は選択集合の要素数', () => {
    expect(resolveRawSelectedCount(state, 24)).toBe(1);
  });
});
