import { describe, expect, it } from 'vitest';

import {
  extractInsightDailySeries,
  extractInsightMetric,
  insightEndTimeToDateKey,
  parseInsightRawValue,
  type GraphInsightValue,
} from '@/server/lib/instagram-insights';

describe('parseInsightRawValue', () => {
  it('数値をそのまま返す', () => {
    expect(parseInsightRawValue(42)).toBe(42);
  });

  it('数値文字列を数値に変換する', () => {
    expect(parseInsightRawValue('123')).toBe(123);
  });

  it('非数値は null を返す', () => {
    expect(parseInsightRawValue('abc')).toBeNull();
    expect(parseInsightRawValue(null)).toBeNull();
    expect(parseInsightRawValue(undefined)).toBeNull();
  });

  it('ネストした value オブジェクトから数値を取り出す', () => {
    expect(parseInsightRawValue({ value: 99 })).toBe(99);
  });
});

describe('extractInsightMetric', () => {
  it('先頭 values の metric を返す', () => {
    const values: GraphInsightValue[] = [
      { name: 'reach', values: [{ value: 100 }, { value: 200 }] },
    ];
    expect(extractInsightMetric(values, 'reach')).toBe(100);
  });

  it('data が空のとき null を返す', () => {
    expect(extractInsightMetric([], 'reach')).toBeNull();
  });
});

describe('insightEndTimeToDateKey', () => {
  it('end_time の前日を YYYY-MM-DD で返す', () => {
    expect(insightEndTimeToDateKey('2026-07-21T07:00:00+0000')).toBe('2026-07-20');
  });
});

describe('extractInsightDailySeries', () => {
  it('日次系列を date と value に展開する', () => {
    const values: GraphInsightValue[] = [
      {
        name: 'reach',
        values: [
          { value: 10, end_time: '2026-07-21T07:00:00+0000' },
          { value: 20, end_time: '2026-07-22T07:00:00+0000' },
        ],
      },
    ];
    expect(extractInsightDailySeries(values, 'reach')).toEqual([
      { date: '2026-07-20', value: 10 },
      { date: '2026-07-21', value: 20 },
    ]);
  });
});
