import { describe, expect, it } from 'vitest';

import { resolveGa4SyncRange, splitGa4SyncRange } from '@/server/lib/ga4-sync-range';

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

describe('splitGa4SyncRange', () => {
  it('maxDays以下の範囲は分割しない', () => {
    expect(
      splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-30' }, 30)
    ).toEqual([{ startDate: '2026-08-01', endDate: '2026-08-30' }]);
  });

  it('90日を30日ずつ3窓へ古い順に分割し、境界日を重複も欠落もさせない', () => {
    expect(
      splitGa4SyncRange({ startDate: '2026-05-20', endDate: '2026-08-17' }, 30)
    ).toEqual([
      { startDate: '2026-05-20', endDate: '2026-06-18' },
      { startDate: '2026-06-19', endDate: '2026-07-18' },
      { startDate: '2026-07-19', endDate: '2026-08-17' },
    ]);
  });

  it('割り切れない範囲は最後の窓だけが短くなる', () => {
    expect(
      splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-05' }, 2)
    ).toEqual([
      { startDate: '2026-08-01', endDate: '2026-08-02' },
      { startDate: '2026-08-03', endDate: '2026-08-04' },
      { startDate: '2026-08-05', endDate: '2026-08-05' },
    ]);
  });

  it('1日だけの範囲は1窓になる', () => {
    expect(
      splitGa4SyncRange({ startDate: '2026-08-17', endDate: '2026-08-17' }, 30)
    ).toEqual([{ startDate: '2026-08-17', endDate: '2026-08-17' }]);
  });

  it('maxDaysが0以下なら例外にする（無限ループを防ぐ）', () => {
    expect(() =>
      splitGa4SyncRange({ startDate: '2026-08-01', endDate: '2026-08-05' }, 0)
    ).toThrow('maxDays must be >= 1');
  });
});
