import { describe, expect, it } from 'vitest';

import {
  hasExceededInstagramRateThreshold,
  parseInstagramRateUsage,
} from '@/server/lib/instagram-rate-limit';

describe('parseInstagramRateUsage', () => {
  it('X-App-Usage から call_count を読む', () => {
    const headers = new Headers({
      'X-App-Usage': JSON.stringify({ call_count: 42 }),
    });
    expect(parseInstagramRateUsage(headers).appUsage.callCount).toBe(42);
  });
});

describe('hasExceededInstagramRateThreshold', () => {
  it('call_count が閾値以上なら true', () => {
    expect(
      hasExceededInstagramRateThreshold(
        { appUsage: { callCount: 80, totalTime: null, totalCpuTime: null }, bucUsage: null },
        80
      )
    ).toBe(true);
  });

  it('call_count が無い場合は false', () => {
    expect(
      hasExceededInstagramRateThreshold(
        { appUsage: { callCount: null, totalTime: null, totalCpuTime: null }, bucUsage: null },
        80
      )
    ).toBe(false);
  });
});
