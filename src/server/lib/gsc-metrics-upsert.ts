import type { PostgrestError } from '@supabase/supabase-js';

const GSC_METRICS_UPSERT_CHUNK_SIZE = 200;
const GSC_METRICS_UPSERT_MIN_CHUNK_SIZE = 25;

const STATEMENT_TIMEOUT_CODE = '57014';

/** 既存行を読む範囲。一意キーの先頭列（user_id, property_uri, date）か URL の索引で引ける粒度にする */
export interface GscMetricsReadScope {
  userId: string;
  propertyUri: string;
  searchType: string;
  dateFrom: string;
  dateTo: string;
  normalizedUrl: string | null;
}

/**
 * 入力が1つの URL だけ（記事単位の取込）なら期間全体を1回で読み、
 * 複数の URL を含むなら日ごとに読む（その日の全 URL を読むことになるため、期間でまとめると読みすぎる）。
 */
export function groupByReadScope<T>(
  rows: readonly T[],
  scopeOf: (row: T) => { userId: string; propertyUri: string; searchType: string; date: string },
  normalizedUrlOf: (row: T) => string | null
): Array<{ scope: GscMetricsReadScope; rows: T[] }> {
  const bySource = new Map<string, Array<{ row: T; date: string; url: string | null }>>();
  for (const row of rows) {
    const { userId, propertyUri, searchType, date } = scopeOf(row);
    const key = JSON.stringify([userId, propertyUri, searchType]);
    const entries = bySource.get(key) ?? [];
    entries.push({ row, date, url: normalizedUrlOf(row) });
    bySource.set(key, entries);
  }

  const groups: Array<{ scope: GscMetricsReadScope; rows: T[] }> = [];
  for (const entries of bySource.values()) {
    const first = entries[0];
    if (!first) continue;
    const { userId, propertyUri, searchType } = scopeOf(first.row);
    const urls = new Set(entries.map(entry => entry.url));
    if (urls.size === 1 && first.url) {
      const dates = entries.map(entry => entry.date).sort();
      groups.push({
        scope: {
          userId,
          propertyUri,
          searchType,
          dateFrom: dates[0] ?? first.date,
          dateTo: dates[dates.length - 1] ?? first.date,
          normalizedUrl: first.url,
        },
        rows: entries.map(entry => entry.row),
      });
      continue;
    }
    const byDate = new Map<string, T[]>();
    for (const entry of entries) {
      byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry.row]);
    }
    for (const [date, dateRows] of byDate) {
      groups.push({
        scope: { userId, propertyUri, searchType, dateFrom: date, dateTo: date, normalizedUrl: null },
        rows: dateRows,
      });
    }
  }
  return groups;
}

/**
 * 既存行と値が同じ行を除き、新規行と値が変わった行だけを返す。
 * キーが null の行は既存行と突き合わせられないため常に書く。
 */
export function selectChangedRows<T, E>(
  incoming: readonly T[],
  existing: readonly E[],
  incomingKey: (row: T) => string | null,
  existingKey: (row: E) => string | null,
  isSame: (row: T, stored: E) => boolean
): T[] {
  const existingByKey = new Map<string, E>();
  for (const row of existing) {
    const key = existingKey(row);
    if (key !== null) existingByKey.set(key, row);
  }
  return incoming.filter(row => {
    const key = incomingKey(row);
    const stored = key === null ? undefined : existingByKey.get(key);
    return stored === undefined || !isSame(row, stored);
  });
}

/**
 * supabase-js は数値を JSON の最短の10進表記で送り、Postgres の numeric はそれを
 * 0 から遠い方へ四捨五入して scale 桁に丸める。同じ規則で 10^scale 倍の整数にする。
 */
function toNumericUnits(value: number, scale: number): number {
  const text = String(Math.abs(value));
  if (text.includes('e')) {
    return Math.sign(value) * Math.round(Math.abs(value) * 10 ** scale);
  }
  const [integerPart = '0', fraction = ''] = text.split('.');
  const kept = Number(integerPart + fraction.slice(0, scale).padEnd(scale, '0'));
  const roundsUp = (fraction[scale] ?? '0') >= '5';
  return Math.sign(value) * (kept + (roundsUp ? 1 : 0));
}

/** numeric(p, scale) 列に incoming を書いたとき stored と同じ値に丸まるか */
export function isSameAtScale(incoming: number, stored: number, scale: number): boolean {
  return toNumericUnits(incoming, scale) === Math.round(stored * 10 ** scale);
}

export function chunkRows<T>(rows: readonly T[], size = GSC_METRICS_UPSERT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * statement timeout（57014）のときだけチャンクを半分に割って書き直す。
 * 半分が下限を下回る大きさでも失敗したら、その時点のエラーを返す（残りは書かない）。
 */
export async function upsertSplittingOnTimeout<T>(
  rows: T[],
  upsert: (chunk: T[]) => PromiseLike<{ error: PostgrestError | null }>,
  minChunkSize = GSC_METRICS_UPSERT_MIN_CHUNK_SIZE
): Promise<{ written: number; error: PostgrestError | null }> {
  const { error } = await upsert(rows);
  if (!error) return { written: rows.length, error: null };

  const half = Math.ceil(rows.length / 2);
  if (error.code !== STATEMENT_TIMEOUT_CODE || half < minChunkSize) {
    return { written: 0, error };
  }

  console.warn('[gsc-metrics-upsert] statement timeout, retrying with half chunk', {
    chunkSize: rows.length,
    nextChunkSize: half,
  });
  const first = await upsertSplittingOnTimeout(rows.slice(0, half), upsert, minChunkSize);
  if (first.error) return first;
  const second = await upsertSplittingOnTimeout(rows.slice(half), upsert, minChunkSize);
  return { written: first.written + second.written, error: second.error };
}
