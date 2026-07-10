import { describe, expect, it } from 'vitest';

import { normalizeUrl } from '@/lib/normalize-url';

describe('normalizeUrl', () => {
  it.each([null, undefined, ''])(`%s は null を返す`, input => {
    expect(normalizeUrl(input)).toBeNull();
  });

  it('URL全体を小文字化し、プロトコル・www・末尾スラッシュを除去する', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/Path///')).toBe('example.com/path');
  });

  it('クエリとフラグメントを保持して小文字化する', () => {
    expect(normalizeUrl('https://Example.com/Path?Query=VALUE#Section')).toBe(
      'example.com/path?query=value#section'
    );
  });

  it('文字列末尾にあるクエリ値のスラッシュも除去する', () => {
    expect(normalizeUrl('https://Example.com/Path?Query=VALUE/')).toBe(
      'example.com/path?query=value'
    );
  });
});
