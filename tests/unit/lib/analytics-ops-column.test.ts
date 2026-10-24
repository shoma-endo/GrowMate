import { describe, expect, it } from 'vitest';
import { getAnalyticsOpsColumnStyle } from '@/lib/analytics-ops-column';

describe('getAnalyticsOpsColumnStyle', () => {
  it('展開時は幅を固定せず、ボタンの数が多い行に合わせて広がる', () => {
    expect(getAnalyticsOpsColumnStyle(true)).toBeUndefined();
  });

  it('折りたたみ時は幅を固定する', () => {
    expect(getAnalyticsOpsColumnStyle(false)).toEqual({ width: '120px', minWidth: '120px', maxWidth: '120px' });
  });
});
