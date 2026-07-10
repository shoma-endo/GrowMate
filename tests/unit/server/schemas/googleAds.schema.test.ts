import { describe, expect, it } from 'vitest';

import {
  getKeywordMetricsSchema,
  keywordMetricsQuerySchema,
} from '@/server/schemas/googleAds.schema';

describe('getKeywordMetricsSchema', () => {
  it('正常な日付範囲と数字のみのcampaign IDを受理する', () => {
    expect(
      getKeywordMetricsSchema.safeParse({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        campaignIds: ['123', '456'],
      }).success
    ).toBe(true);
  });

  it.each([
    ['不正日付', { startDate: '2026-02-30', endDate: '2026-03-01' }],
    ['逆転範囲', { startDate: '2026-02-02', endDate: '2026-02-01' }],
    [
      '非数字ID',
      { startDate: '2026-01-01', endDate: '2026-01-31', campaignIds: ['campaign-1'] },
    ],
  ])('%s を拒否する', (_label, input) => {
    expect(getKeywordMetricsSchema.safeParse(input).success).toBe(false);
  });
});

describe('keywordMetricsQuerySchema', () => {
  it('正常な日付範囲を受理する', () => {
    expect(
      keywordMetricsQuerySchema.safeParse({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      }).success
    ).toBe(true);
  });

  it.each([
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-02-02', endDate: '2026-02-01' },
  ])('不正な日付範囲を拒否する', input => {
    expect(keywordMetricsQuerySchema.safeParse(input).success).toBe(false);
  });
});
