import { describe, expect, it } from 'vitest';

import { resolveGa4SyncRange } from '@/server/lib/ga4-sync-range';

const baseInput = {
  todayJst: '2026-08-18',
  lastSyncedDate: null,
  initialSyncDays: 30,
};

describe('resolveGa4SyncRange', () => {
  it('backfillDays=90はカーソルを無視して前日から90日分を返す', () => {
    expect(
      resolveGa4SyncRange({
        ...baseInput,
        lastSyncedDate: '2026-08-17',
        backfillDays: 90,
      })
    ).toEqual({
      ok: true,
      range: { startDate: '2026-05-20', endDate: '2026-08-17' },
    });
  });

  it('backfillDays=1は前日だけを返す', () => {
    expect(resolveGa4SyncRange({ ...baseInput, backfillDays: 1 })).toEqual({
      ok: true,
      range: { startDate: '2026-08-17', endDate: '2026-08-17' },
    });
  });

  it('カーソルありの通常同期は翌日から前日までを返す', () => {
    expect(
      resolveGa4SyncRange({ ...baseInput, lastSyncedDate: '2026-08-10' })
    ).toEqual({
      ok: true,
      range: { startDate: '2026-08-11', endDate: '2026-08-17' },
    });
  });

  it('カーソルなしの通常同期は初回日数分を返す', () => {
    expect(resolveGa4SyncRange(baseInput)).toEqual({
      ok: true,
      range: { startDate: '2026-07-19', endDate: '2026-08-17' },
    });
  });

  it('カーソルが前日以降の通常同期はalready_syncedを返す', () => {
    expect(
      resolveGa4SyncRange({ ...baseInput, lastSyncedDate: '2026-08-17' })
    ).toEqual({ ok: false, reason: 'already_synced' });
  });
});
