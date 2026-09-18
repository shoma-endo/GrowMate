import { describe, expect, it } from 'vitest';

import { hasAnyStatusFilter, parseStatusFilterConfig } from '@/lib/constants';

const NONE = {
  unreadSuggestion: false,
  unstartedGscEvaluation: false,
  unsummarized: false,
};

describe('parseStatusFilterConfig', () => {
  // 既定が「絞り込みあり」に倒れると、残留フィルターで一覧がほぼ空になり
  // 利用者が記事の消失と誤認する。壊れた入力はすべて「絞り込みなし」へ畳む
  it('null は絞り込みなしへ畳む', () => {
    expect(parseStatusFilterConfig(null)).toEqual(NONE);
  });

  it('空文字は絞り込みなしへ畳む', () => {
    expect(parseStatusFilterConfig('')).toEqual(NONE);
  });

  it('壊れた JSON は絞り込みなしへ畳む', () => {
    expect(parseStatusFilterConfig('{"unreadSuggestion":')).toEqual(NONE);
  });

  it('オブジェクト以外の JSON は絞り込みなしへ畳む', () => {
    expect(parseStatusFilterConfig('"unreadSuggestion"')).toEqual(NONE);
    expect(parseStatusFilterConfig('[true]')).toEqual(NONE);
    expect(parseStatusFilterConfig('null')).toEqual(NONE);
  });

  it('boolean 以外の値は false として扱う', () => {
    expect(
      parseStatusFilterConfig(
        JSON.stringify({ unreadSuggestion: 1, unstartedGscEvaluation: 'true', unsummarized: null })
      )
    ).toEqual(NONE);
  });

  it('欠けているキーは false で補う', () => {
    expect(parseStatusFilterConfig(JSON.stringify({ unreadSuggestion: true }))).toEqual({
      unreadSuggestion: true,
      unstartedGscEvaluation: false,
      unsummarized: false,
    });
  });

  it('保存した内容をそのまま読み戻せる', () => {
    const saved = {
      unreadSuggestion: true,
      unstartedGscEvaluation: false,
      unsummarized: true,
    };
    expect(parseStatusFilterConfig(JSON.stringify(saved))).toEqual(saved);
  });

  it('未知のキーは落とす', () => {
    expect(
      parseStatusFilterConfig(JSON.stringify({ unreadSuggestion: true, bogus: true }))
    ).toEqual({
      unreadSuggestion: true,
      unstartedGscEvaluation: false,
      unsummarized: false,
    });
  });
});

describe('hasAnyStatusFilter', () => {
  it('すべて false なら false', () => {
    expect(hasAnyStatusFilter(NONE)).toBe(false);
  });

  // 1つでも立っていれば復元対象。取りこぼすと絞り込みが戻らない
  it.each([
    ['unreadSuggestion' as const],
    ['unstartedGscEvaluation' as const],
    ['unsummarized' as const],
  ])('%s だけ立っていても true', key => {
    expect(hasAnyStatusFilter({ ...NONE, [key]: true })).toBe(true);
  });
});
