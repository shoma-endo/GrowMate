import { describe, expect, it } from 'vitest';

import { ga4DateStringToIso, normalizeToPath } from '@/lib/ga4-utils';

describe('normalizeToPath', () => {
  it.each([null, undefined, '', '   ', 'example.com', '?query=1', '#section'])(
    '%s はルートパスを返す',
    input => {
      expect(normalizeToPath(input)).toBe('/');
    }
  );

  it('フルURLを小文字のパスに正規化する', () => {
    expect(normalizeToPath('HTTPS://WWW.Example.COM/News/Article/?Query=1#Section')).toBe(
      '/news/article'
    );
  });

  it('パス入力からクエリ・フラグメント・末尾スラッシュを除去する', () => {
    expect(normalizeToPath('/News/Article///?Query=1#Section')).toBe('/news/article');
  });
});

describe('ga4DateStringToIso', () => {
  it('8桁文字列をYYYY-MM-DDへ変換する', () => {
    expect(ga4DateStringToIso('20260131')).toBe('2026-01-31');
  });

  it.each(['2026-01-31', '2026013', 'abcdefgh'])(
    '8桁の数字ではない %s は入力をそのまま返す',
    input => {
      expect(ga4DateStringToIso(input)).toBe(input);
    }
  );

  it('8桁なら実在しない日付も形式変換だけを行う', () => {
    expect(ga4DateStringToIso('20260231')).toBe('2026-02-31');
  });
});
