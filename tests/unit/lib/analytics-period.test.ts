import { describe, expect, it } from 'vitest';

import { clampAnalyticsPeriod } from '@/lib/analytics-period';

describe('analytics-period', () => {
  it('100日を上限にする', () => {
    expect(clampAnalyticsPeriod('2026-01-01', '2026-04-10')).toEqual({
      startDate: '2026-01-01', endDate: '2026-04-10', clamped: false,
    });
    expect(clampAnalyticsPeriod('2026-01-01', '2026-04-11')).toEqual({
      startDate: '2026-01-02', endDate: '2026-04-11', clamped: true,
    });
    expect(clampAnalyticsPeriod('2026-01-01', '2026-04-10')).toEqual({
      startDate: '2026-01-01', endDate: '2026-04-10', clamped: false,
    });
  });
});
