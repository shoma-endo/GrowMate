import { describe, expect, it } from 'vitest';

import {
  buildContentCsvImportBatches,
  buildContentCsvTemplate,
  CONTENT_CSV_IMPORT_LIMITS,
  ContentCsvImportParseError,
  decodeContentCsv,
  parseContentCsv,
} from '@/lib/content-csv-import';

describe('content CSV import', () => {
  it.each([
    ['quoted commas', '記事URL,主軸kw\nhttps://example.com,"one,two"', 'one,two'],
    ['escaped quotes', '記事URL,主軸kw\nhttps://example.com,"say ""hi"""', 'say "hi"'],
    ['quoted newlines', '記事URL,主軸kw\nhttps://example.com,"line one\nline two"', 'line one\nline two'],
    ['CRLF records', '記事URL,主軸kw\r\nhttps://example.com,keyword', 'keyword'],
  ])('parses %s', (_label, input, expected) => {
    expect(parseContentCsv(input).rows[0]?.values.main_kw).toBe(expected);
  });

  it('decodes UTF-8 BOM and rejects invalid UTF-8 bytes', () => {
    expect(decodeContentCsv(new TextEncoder().encode('\uFEFF記事URL,主軸kw'))).toBe('記事URL,主軸kw');
    expect(() => decodeContentCsv(Uint8Array.from([0x82, 0xa0]))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENCODING' })
    );
  });

  it('maps reordered NFKC headers and ignores unknown columns', () => {
    const result = parseContentCsv('kw(参考),未知,URL,主軸kw\nrelated,ignored,https://example.com/main,main');
    expect(result.rows).toEqual([{
      rowNumber: 2,
      url: 'https://example.com/main',
      values: { main_kw: 'main', kw: 'related' },
    }]);
  });

  it('rejects a missing URL column', () => {
    expect(() => parseContentCsv('主軸kw\nkeyword')).toThrowError(
      expect.objectContaining({ code: 'URL_COLUMN_MISSING' })
    );
  });

  it('accepts 20,000 nonblank data rows and rejects 20,001', () => {
    const rows = Array.from({ length: CONTENT_CSV_IMPORT_LIMITS.maxRows }, (_, index) => `https://example.com/${index},x`);
    expect(parseContentCsv(`記事URL,主軸kw\n${rows.join('\n')}`).rows).toHaveLength(20_000);
    expect(() => parseContentCsv(`記事URL,主軸kw\n${rows.join('\n')}\nhttps://example.com/extra,x`)).toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_ROWS' })
    );
  });

  it('uses spreadsheet row numbers when a cell contains a newline', () => {
    const result = parseContentCsv('記事URL,主軸kw\nhttps://example.com/a,"first\nsecond"\nhttps://example.com/b,next');
    expect(result.rows.map(row => row.rowNumber)).toEqual([2, 4]);
  });

  it.each([
    ['Japanese path', ' https://example.com/記事 ', 'https://example.com/%E8%A8%98%E4%BA%8B'],
    ['missing scheme', 'example.com/article', null],
    ['non-http scheme', 'ftp://example.com/article', null],
  ])('canonicalizes URL: %s', (_label, value, expected) => {
    const result = parseContentCsv(`記事URL\n${value}`);
    if (expected === null) {
      expect(result.skipped).toMatchObject([{ reason: 'invalid_url' }]);
      expect(result.rows).toHaveLength(0);
    } else {
      expect(result.rows[0]?.url).toBe(expected);
    }
  });

  it('keeps the last normalized URL row and counts earlier duplicates', () => {
    const result = parseContentCsv('記事URL,主軸kw\nhttps://example.com/a,first\nhttp://www.example.com/a/,last');
    expect(result.rows).toEqual([{
      rowNumber: 3,
      url: 'http://www.example.com/a/',
      values: { main_kw: 'last' },
    }]);
    expect(result.duplicateCount).toBe(1);
  });

  it('skips a row with a cell over 20,000 characters', () => {
    const result = parseContentCsv(`記事URL,主軸kw\nhttps://example.com,${'x'.repeat(20_001)}`);
    expect(result.skipped).toMatchObject([{ rowNumber: 2, reason: 'too_long' }]);
    expect(result.rows).toHaveLength(0);
  });

  it('splits batches below the UTF-8 byte and row limits', () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => ({
      rowNumber: index + 2,
      url: `https://example.com/${index}`,
      values: { main_kw: '記事'.repeat(100) },
    }));
    const batches = buildContentCsvImportBatches(rows);
    expect(batches.every(batch => batch.length <= 2_000)).toBe(true);
    expect(batches.every(batch => new TextEncoder().encode(JSON.stringify({ rows: batch })).byteLength < 800 * 1024)).toBe(true);
    expect(batches.flat()).toHaveLength(rows.length);
  });

  it('builds the UTF-8 BOM template with the approved headers', () => {
    expect(buildContentCsvTemplate()).toBe('\uFEFF記事URL,主軸kw,kw（参考）,表示回数,ニーズ,デモグラ・ペルソナ,ゴール,PREP,基本構成,書き出し案');
  });
});
