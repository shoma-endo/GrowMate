import { addDaysISO } from '@/lib/date-utils';

interface Ga4SyncRange {
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
