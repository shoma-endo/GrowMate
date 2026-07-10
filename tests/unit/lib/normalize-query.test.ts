import { describe, expect, it } from 'vitest';

import { normalizeQuery } from '@/lib/normalize-query';

describe('normalizeQuery', () => {
  it.each([null, undefined, '', '   '])(`%s は空文字を返す`, input => {
    expect(normalizeQuery(input)).toBe('');
  });

  it('NFKC正規化、小文字化、連続空白の畳み込みを行う', () => {
    expect(normalizeQuery('  ＧｒｏｗＭａｔｅ\t 検索　キーワード  ')).toBe(
      'growmate 検索 キーワード'
    );
  });
});
