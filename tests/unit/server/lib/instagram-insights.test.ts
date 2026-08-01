import { describe, expect, it } from 'vitest';

import {
  extractInsightMetric,
  extractLatestInsightMetric,
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

  it('metric が欠落しているとき null を返す', () => {
    const values: GraphInsightValue[] = [{ name: 'views', values: [{ value: 10 }] }];
    expect(extractInsightMetric(values, 'reach')).toBeNull();
  });

  it('values が空のとき null を返す', () => {
    const values: GraphInsightValue[] = [{ name: 'reach', values: [] }];
    expect(extractInsightMetric(values, 'reach')).toBeNull();
  });
});

describe('extractLatestInsightMetric', () => {
  it('最新日の metric を返す', () => {
    const values: GraphInsightValue[] = [
      { name: 'reach', values: [{ value: 100 }, { value: 250 }] },
    ];
    expect(extractLatestInsightMetric(values, 'reach')).toBe(250);
  });

  it('data が空のとき null を返す', () => {
    expect(extractLatestInsightMetric([], 'reach')).toBeNull();
  });

  it('metric が欠落しているとき null を返す', () => {
    const values: GraphInsightValue[] = [{ name: 'views', values: [{ value: 10 }] }];
    expect(extractLatestInsightMetric(values, 'reach')).toBeNull();
  });

  it('values が空のとき null を返す', () => {
    const values: GraphInsightValue[] = [{ name: 'reach', values: [] }];
    expect(extractLatestInsightMetric(values, 'reach')).toBeNull();
  });
});
