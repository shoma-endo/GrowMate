import { describe, expect, it } from 'vitest';
import { buildGscDailyImportRange } from '@/server/lib/gsc-import-utils';

describe('GSC日次期間（auto-daily-imports-spec FR-001）', () => {
  it.each([
    ['夏時間', '2026-07-14T19:05:00.000Z', '2026-07-12', '2026-07-14'],
    ['冬時間', '2026-01-14T19:05:00.000Z', '2026-01-12', '2026-01-14'],
  ])('PTの当日を終了日にする（%s）', (_label, now, startDate, endDate) => {
    expect(buildGscDailyImportRange(new Date(now))).toEqual({ startDate, endDate });
  });
});
