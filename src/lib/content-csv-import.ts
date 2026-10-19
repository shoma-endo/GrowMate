import { ANALYTICS_COLUMNS } from '@/lib/constants';
import { normalizeUrl } from '@/lib/normalize-url';
import { ANNOTATION_FIELD_KEYS, type AnnotationFieldKey } from '@/types/annotation';

export const CONTENT_CSV_IMPORT_LIMITS = {
  maxRows: 20_000,
  maxCellLength: 20_000,
  maxBatchRows: 2_000,
  maxBatchBytes: 800 * 1024,
} as const;

type ContentCsvSkipReason = 'invalid_url' | 'too_long' | 'multiple_matches' | 'no_values';

export interface ContentCsvImportRow {
  rowNumber: number;
  url: string;
  values: Partial<Record<AnnotationFieldKey, string>>;
}

export interface ContentCsvSkippedRow {
  rowNumber: number;
  url: string;
  reason: ContentCsvSkipReason;
}

interface CsvRecord {
  rowNumber: number;
  cells: string[];
}

export interface ParsedContentCsv {
  rows: ContentCsvImportRow[];
  skipped: ContentCsvSkippedRow[];
  duplicateCount: number;
}

export class ContentCsvImportParseError extends Error {
  constructor(readonly code: 'INVALID_ENCODING' | 'URL_COLUMN_MISSING' | 'TOO_MANY_ROWS' | 'MALFORMED_CSV') {
    super(code);
  }
}

export function decodeContentCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new ContentCsvImportParseError('INVALID_ENCODING');
  }
}

function parseCsvRecords(input: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let rowNumber = 1;
  let recordStarted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
      } else if (cell.length === 0) {
        quoted = true;
        recordStarted = true;
      } else {
        throw new ContentCsvImportParseError('MALFORMED_CSV');
      }
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (quoted) {
        cell += char;
        if (char === '\r' && input[index + 1] === '\n') {
          cell += '\n';
          index += 1;
        }
        continue;
      }

      cells.push(cell);
      records.push({ rowNumber, cells });
      cells = [];
      cell = '';
      recordStarted = false;
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      rowNumber += 1;
      continue;
    }

    if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
      recordStarted = true;
      continue;
    }

    cell += char;
    recordStarted = true;
  }

  if (quoted) throw new ContentCsvImportParseError('MALFORMED_CSV');
  if (recordStarted || cells.length > 0 || cell.length > 0) {
    cells.push(cell);
    records.push({ rowNumber, cells });
  }
  return records;
}

function normalizedHeader(value: string): string {
  return value.trim().normalize('NFKC');
}

export function canonicalizeContentCsvUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function isBlankRow(cells: string[]): boolean {
  return cells.every(value => value.trim() === '');
}

export function parseContentCsv(input: string): ParsedContentCsv {
  const records = parseCsvRecords(input);
  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) throw new ContentCsvImportParseError('URL_COLUMN_MISSING');

  const headers = headerRecord.cells.map(normalizedHeader);
  const urlColumn = headers.indexOf('記事URL') >= 0 ? headers.indexOf('記事URL') : headers.indexOf('URL');
  if (urlColumn < 0) throw new ContentCsvImportParseError('URL_COLUMN_MISSING');

  const fieldColumns = new Map<AnnotationFieldKey, number>();
  for (const key of ANNOTATION_FIELD_KEYS) {
    const label = ANALYTICS_COLUMNS.find(column => column.id === key)?.label;
    if (!label) throw new Error(`CSV template label is missing for ${key}`);
    const column = headers.indexOf(normalizedHeader(label));
    if (column >= 0) fieldColumns.set(key, column);
  }

  const nonblankRecords = dataRecords.filter(record => !isBlankRow(record.cells));
  if (nonblankRecords.length > CONTENT_CSV_IMPORT_LIMITS.maxRows) {
    throw new ContentCsvImportParseError('TOO_MANY_ROWS');
  }

  const lastRowByUrl = new Map<string, ContentCsvImportRow>();
  const skipped: ContentCsvSkippedRow[] = [];
  let duplicateCount = 0;

  for (const record of nonblankRecords) {
    const rawUrl = record.cells[urlColumn]?.trim() ?? '';
    const url = canonicalizeContentCsvUrl(rawUrl);
    if (!url) {
      skipped.push({ rowNumber: record.rowNumber, url: rawUrl, reason: 'invalid_url' });
      continue;
    }

    const key = normalizeUrl(url);
    if (key === null) {
      skipped.push({ rowNumber: record.rowNumber, url, reason: 'invalid_url' });
      continue;
    }

    const values: Partial<Record<AnnotationFieldKey, string>> = {};
    for (const [field, column] of fieldColumns) {
      const value = record.cells[column]?.trim() ?? '';
      if (value !== '') values[field] = value;
    }
    if (lastRowByUrl.has(key)) duplicateCount += 1;
    lastRowByUrl.set(key, { rowNumber: record.rowNumber, url, values });
  }

  const rows: ContentCsvImportRow[] = [];
  for (const row of lastRowByUrl.values()) {
    const cells = [row.url, ...ANNOTATION_FIELD_KEYS.map(key => row.values[key] ?? '')];
    if (cells.some(value => value.length > CONTENT_CSV_IMPORT_LIMITS.maxCellLength)) {
      skipped.push({ rowNumber: row.rowNumber, url: row.url, reason: 'too_long' });
      continue;
    }
    rows.push(row);
  }

  skipped.sort((left, right) => left.rowNumber - right.rowNumber);
  return { rows: rows.sort((left, right) => left.rowNumber - right.rowNumber), skipped, duplicateCount };
}

export function contentCsvTemplateHeaders(): Array<{ key: 'url' | AnnotationFieldKey; label: string }> {
  return [
    { key: 'url', label: '記事URL' },
    ...ANNOTATION_FIELD_KEYS.map(key => {
      const label = ANALYTICS_COLUMNS.find(column => column.id === key)?.label;
      if (!label) throw new Error(`CSV template label is missing for ${key}`);
      return { key, label };
    }),
  ];
}

export function buildContentCsvTemplate(): string {
  return `\uFEFF${contentCsvTemplateHeaders().map(header => header.label).join(',')}`;
}

export function buildContentCsvImportBatches(rows: ContentCsvImportRow[]): ContentCsvImportRow[][] {
  const encoder = new TextEncoder();
  // JSON.stringify({ rows }) は '{"rows":[' + 各行を ',' でつないだもの + ']}' なので、行ごとのバイト数を足して全体の大きさを出す
  const envelopeBytes = encoder.encode(JSON.stringify({ rows: [] })).byteLength;
  const batches: ContentCsvImportRow[][] = [];
  let batch: ContentCsvImportRow[] = [];
  let batchBytes = envelopeBytes;

  for (const row of rows) {
    const rowBytes = encoder.encode(JSON.stringify(row)).byteLength;
    if (envelopeBytes + rowBytes >= CONTENT_CSV_IMPORT_LIMITS.maxBatchBytes) {
      throw new Error('A CSV row exceeds the import batch size limit');
    }
    const nextBytes = batchBytes + rowBytes + (batch.length > 0 ? 1 : 0);
    if (batch.length + 1 > CONTENT_CSV_IMPORT_LIMITS.maxBatchRows || nextBytes >= CONTENT_CSV_IMPORT_LIMITS.maxBatchBytes) {
      batches.push(batch);
      batch = [row];
      batchBytes = envelopeBytes + rowBytes;
    } else {
      batch.push(row);
      batchBytes = nextBytes;
    }
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}
