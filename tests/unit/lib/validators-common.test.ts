import { describe, expect, it } from 'vitest';

import {
  dateStringSchema,
  validateDateRange,
  validateTitle,
} from '@/lib/validators/common';

describe('validateTitle', () => {
  it.each(['', '   '])('空タイトル %j を拒否する', input => {
    expect(validateTitle(input)).not.toBeNull();
  });

  it('trim後60文字を受理する', () => {
    expect(validateTitle(`  ${'a'.repeat(60)}  `)).toBeNull();
  });

  it('trim後61文字を拒否する', () => {
    expect(validateTitle(`  ${'a'.repeat(61)}  `)).not.toBeNull();
  });
});

describe('dateStringSchema', () => {
  it('実在するYYYY-MM-DDを受理する', () => {
    expect(dateStringSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it.each(['2026/01/01', '2026-02-30'])('不正日付 %s を拒否する', input => {
    expect(dateStringSchema.safeParse(input).success).toBe(false);
  });
});

describe('validateDateRange', () => {
  it.each([
    ['開始日が終了日より前', '2026-01-31'],
    ['同日（境界）', '2026-01-01'],
  ])('%sなら受理する', (_label, endDate) => {
    expect(validateDateRange('2026-01-01', endDate)).toBeNull();
  });

  it('開始日が終了日より後なら拒否する', () => {
    expect(validateDateRange('2026-01-02', '2026-01-01')).not.toBeNull();
  });

  it.each([
    ['', '2026-01-01'],
    ['2026-01-01', ''],
    ['2026-02-30', '2026-03-01'],
  ])('不正な範囲 %s〜%s を拒否する', (start, end) => {
    expect(validateDateRange(start, end)).not.toBeNull();
  });
});
