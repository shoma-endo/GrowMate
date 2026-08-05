import { describe, expect, it } from 'vitest';

import { getInstagramSyncToastMessage } from '@/lib/instagram-sync';

describe('getInstagramSyncToastMessage', () => {
  it('成功時は件数を含む success を返す', () => {
    expect(
      getInstagramSyncToastMessage({
        synced: 3,
        failed: 0,
        skipped: 0,
        truncated: false,
        preConversionCount: 0,
      })
    ).toEqual({ type: 'success', message: '3件を更新しました' });
  });

  it('部分失敗時は warning を返す', () => {
    expect(
      getInstagramSyncToastMessage({
        synced: 2,
        failed: 1,
        skipped: 0,
        truncated: false,
        preConversionCount: 0,
      }).type
    ).toBe('warning');
  });

  it('truncated 時は info を返す', () => {
    expect(
      getInstagramSyncToastMessage({
        synced: 50,
        failed: 0,
        skipped: 0,
        truncated: true,
        preConversionCount: 0,
      }).type
    ).toBe('info');
  });
});
