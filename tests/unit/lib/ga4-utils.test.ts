import { describe, expect, it } from 'vitest';

import {
  ga4DateStringToIso,
  normalizeToPath,
  resolveGa4ScrollEventName,
} from '@/lib/ga4-utils';

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

describe('resolveGa4ScrollEventName', () => {
  it('イベントが1件も返ってこなければ null を返す（未計測。0と区別する）', () => {
    expect(resolveGa4ScrollEventName([])).toBeNull();
    expect(resolveGa4ScrollEventName(['purchase', 'sign_up'])).toBeNull();
  });

  it('カスタムの scroll_90 があればそれを採用する', () => {
    expect(resolveGa4ScrollEventName(['purchase', 'scroll_90'])).toBe('scroll_90');
  });

  it('拡張計測の標準 scroll しか無ければ scroll を採用する', () => {
    expect(resolveGa4ScrollEventName(['scroll', 'purchase'])).toBe('scroll');
  });

  it('両方あっても二重計上しないよう scroll_90 だけを採用する', () => {
    expect(resolveGa4ScrollEventName(['scroll', 'scroll_90'])).toBe('scroll_90');
  });

  it('null / undefined / 空文字は無視する', () => {
    expect(resolveGa4ScrollEventName([null, undefined, '', 'scroll'])).toBe('scroll');
  });
});
