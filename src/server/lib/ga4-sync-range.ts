import { addDaysISO } from '@/lib/date-utils';

export interface Ga4SyncRange {
  startDate: string;
  endDate: string;
}

export type Ga4SyncRangeResult =
  | { ok: true; range: Ga4SyncRange }
  | { ok: false; reason: 'already_synced' };

export interface ResolveGa4SyncRangeInput {
  todayJst: string;
  lastSyncedDate: string | null;
  initialSyncDays: number;
  backfillDays?: number | undefined;
}

export function resolveGa4SyncRange(
  input: ResolveGa4SyncRangeInput
): Ga4SyncRangeResult {
  const endDate = addDaysISO(input.todayJst, -1);

  if (input.backfillDays !== undefined) {
    return {
      ok: true,
      range: {
        startDate: addDaysISO(endDate, -(input.backfillDays - 1)),
        endDate,
      },
    };
  }

  const startDate = input.lastSyncedDate
    ? addDaysISO(input.lastSyncedDate, 1)
    : addDaysISO(endDate, -(input.initialSyncDays - 1));

  if (startDate > endDate) {
    return { ok: false, reason: 'already_synced' };
  }

  return { ok: true, range: { startDate, endDate } };
}

/**
 * 取込範囲を maxDays 日以下の窓へ古い順に分割する。
 *
 * GA4 レポートは1レポートあたり `MAX_TOTAL_ROWS` 行で打ち切られ、`orderBys` を指定していないため
 * どの行が落ちるかが不定になる。過去90日の再取込のように長い範囲を一度に投げると、
 * 打ち切りが `isPartial` として記録されるだけで欠損が静かに残る。窓に割ることで
 * 1レポートあたりの行数を日数で有界化する。
 */
export function splitGa4SyncRange(range: Ga4SyncRange, maxDays: number): Ga4SyncRange[] {
  if (maxDays < 1) {
    throw new Error('maxDays must be >= 1');
  }

  const windows: Ga4SyncRange[] = [];
  let windowStart = range.startDate;

  while (windowStart <= range.endDate) {
    const windowEndCandidate = addDaysISO(windowStart, maxDays - 1);
    const windowEnd = windowEndCandidate > range.endDate ? range.endDate : windowEndCandidate;
    windows.push({ startDate: windowStart, endDate: windowEnd });
    windowStart = addDaysISO(windowEnd, 1);
  }

  return windows;
}
