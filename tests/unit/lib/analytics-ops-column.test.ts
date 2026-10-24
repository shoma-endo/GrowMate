import { describe, expect, it } from 'vitest';
import { getAnalyticsOpsColumnStyle } from '@/lib/analytics-ops-column';

describe('getAnalyticsOpsColumnStyle', () => {
  it('展開時は 1px を指定し、表の余りを受け取らず中身の幅まで縮む', () => {
    expect(getAnalyticsOpsColumnStyle(true)).toEqual({ width: '1px' });
  });

  it('折りたたみ時は幅を固定する', () => {
    expect(getAnalyticsOpsColumnStyle(false)).toEqual({ width: '120px', minWidth: '120px', maxWidth: '120px' });
  });
});
