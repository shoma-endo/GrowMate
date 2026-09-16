import { describe, expect, it } from 'vitest';

import {
  getDefaultFieldConfig,
  isSameFieldConfig,
  normalizeFieldConfig,
  parseLegacyStoredFieldConfig,
} from '@/lib/field-config';
import type { FieldColumnOption } from '@/types/field-config';

/**
 * フィールド構成の正規化。保存済みの構成と列カタログがズレたときの復元を固定する。
 * ここが壊れると「列を追加したのに誰にも表示されない」「全解除が勝手に戻る」が
 * 実行時に無言で起きる。
 */

const COLUMNS: FieldColumnOption[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C', defaultVisible: false },
];

describe('getDefaultFieldConfig', () => {
  it('defaultVisible: false の列だけ非表示にし、並び順はカタログ順', () => {
    expect(getDefaultFieldConfig(COLUMNS)).toEqual({
      visibleIds: ['a', 'b'],
      orderedIds: ['a', 'b', 'c'],
    });
  });
});

describe('normalizeFieldConfig', () => {
  it('未保存（null）なら既定を返す', () => {
    expect(normalizeFieldConfig(COLUMNS, null)).toEqual(getDefaultFieldConfig(COLUMNS));
  });

  it('保存済みの表示・並び順をそのまま尊重する', () => {
    expect(
      normalizeFieldConfig(COLUMNS, { visibleIds: ['b'], orderedIds: ['c', 'b', 'a'] })
    ).toEqual({ visibleIds: ['b'], orderedIds: ['c', 'b', 'a'] });
  });

  it('空の visibleIds は「全解除」として尊重し、既定へ戻さない', () => {
    expect(
      normalizeFieldConfig(COLUMNS, { visibleIds: [], orderedIds: ['a', 'b', 'c'] })
    ).toEqual({ visibleIds: [], orderedIds: ['a', 'b', 'c'] });
  });

  it('カタログから消えた列IDは落とす', () => {
    expect(
      normalizeFieldConfig(COLUMNS, {
        visibleIds: ['a', 'gone'],
        orderedIds: ['gone', 'a', 'b', 'c'],
      })
    ).toEqual({ visibleIds: ['a'], orderedIds: ['a', 'b', 'c'] });
  });

  it('並び順に無い既知の列は末尾へ追補する', () => {
    expect(normalizeFieldConfig(COLUMNS, { visibleIds: ['a'], orderedIds: ['b'] })).toEqual({
      visibleIds: ['a'],
      orderedIds: ['b', 'a', 'c'],
    });
  });

  it('保存後に新設された既定表示の列は表示側にも追補する', () => {
    // 'b' は保存時点のカタログに無かった新設列
    expect(normalizeFieldConfig(COLUMNS, { visibleIds: ['a'], orderedIds: ['a', 'c'] })).toEqual({
      visibleIds: ['a', 'b'],
      orderedIds: ['a', 'c', 'b'],
    });
  });

  it('新設でも defaultVisible: false の列は表示側へ追補しない', () => {
    expect(normalizeFieldConfig(COLUMNS, { visibleIds: ['a'], orderedIds: ['a', 'b'] })).toEqual({
      visibleIds: ['a'],
      orderedIds: ['a', 'b', 'c'],
    });
  });

  it('利用者が外した既存列を、新設列の追補に巻き込んで復活させない', () => {
    // 'b' は保存時点の並び順にあるので新設ではない（＝利用者が意図的に外した）
    expect(
      normalizeFieldConfig(COLUMNS, { visibleIds: ['a'], orderedIds: ['a', 'b', 'c'] })
    ).toEqual({ visibleIds: ['a'], orderedIds: ['a', 'b', 'c'] });
  });

  it('重複した列IDは1つに畳む', () => {
    expect(
      normalizeFieldConfig(COLUMNS, {
        visibleIds: ['a', 'a'],
        orderedIds: ['a', 'a', 'b', 'c'],
      })
    ).toEqual({ visibleIds: ['a'], orderedIds: ['a', 'b', 'c'] });
  });

  it('片方だけ null なら、その側だけ既定で補う', () => {
    expect(normalizeFieldConfig(COLUMNS, { visibleIds: null, orderedIds: ['c', 'b', 'a'] })).toEqual(
      { visibleIds: ['a', 'b'], orderedIds: ['c', 'b', 'a'] }
    );
  });
});

describe('parseLegacyStoredFieldConfig', () => {
  it('旧・表示列のみの配列形式を読む', () => {
    expect(parseLegacyStoredFieldConfig(JSON.stringify(['a', 'b']))).toEqual({
      visibleIds: ['a', 'b'],
      orderedIds: null,
    });
  });

  it('旧・{ visible, order } 形式を読む', () => {
    expect(parseLegacyStoredFieldConfig(JSON.stringify({ visible: ['a'], order: ['b', 'a'] }))).toEqual(
      { visibleIds: ['a'], orderedIds: ['b', 'a'] }
    );
  });

  it('空配列（全解除）を null に畳まない', () => {
    expect(parseLegacyStoredFieldConfig(JSON.stringify({ visible: [], order: ['a'] }))).toEqual({
      visibleIds: [],
      orderedIds: ['a'],
    });
  });

  it('null・壊れたJSON・想定外の形は null', () => {
    expect(parseLegacyStoredFieldConfig(null)).toBeNull();
    expect(parseLegacyStoredFieldConfig('{')).toBeNull();
    expect(parseLegacyStoredFieldConfig(JSON.stringify({ other: 1 }))).toBeNull();
    expect(parseLegacyStoredFieldConfig(JSON.stringify([1, 2]))).toBeNull();
  });
});

describe('isSameFieldConfig', () => {
  it('並び順の違いを同値と誤判定しない（保存の取りこぼしを防ぐ）', () => {
    expect(
      isSameFieldConfig(
        { visibleIds: ['a'], orderedIds: ['a', 'b'] },
        { visibleIds: ['a'], orderedIds: ['b', 'a'] }
      )
    ).toBe(false);
  });

  it('同じ内容なら true', () => {
    expect(
      isSameFieldConfig(
        { visibleIds: ['a'], orderedIds: ['a', 'b'] },
        { visibleIds: ['a'], orderedIds: ['a', 'b'] }
      )
    ).toBe(true);
  });
});
