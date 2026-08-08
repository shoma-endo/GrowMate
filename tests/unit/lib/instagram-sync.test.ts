import { describe, expect, it } from 'vitest';

import { getInstagramSyncToastMessage } from '@/lib/instagram-sync';
import type { InstagramSyncResult } from '@/types/instagram';

function baseResult(overrides: Partial<InstagramSyncResult> = {}): InstagramSyncResult {
  return {
    mode: 'incremental',
    synced: 0,
    failed: 0,
    skipped: 0,
    truncated: false,
    preConversionCount: 0,
    backfillCompleted: false,
    ...overrides,
  };
}

describe('getInstagramSyncToastMessage', () => {
  it('成功時は件数を含む success を返す', () => {
    expect(getInstagramSyncToastMessage(baseResult({ synced: 3 }))).toEqual({
      type: 'success',
      message: '3件を更新しました',
    });
  });

  it('部分失敗時は warning を返す', () => {
    expect(
      getInstagramSyncToastMessage(baseResult({ synced: 2, failed: 1 })).type
    ).toBe('warning');
  });

  it('incremental で truncated 時は info を返し、backfill への誘導文言を含む', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ synced: 50, truncated: true })
    );
    expect(message.type).toBe('info');
    expect(message.message).toContain('過去の投稿をインポート');
  });

  it('incremental の time_budget 中断時は「最新化」への再試行文言を含む', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ synced: 10, stoppedReason: 'time_budget' })
    );
    expect(message.type).toBe('warning');
    expect(message.message).toContain('最新化');
  });

  it('backfill の time_budget 中断時は「過去の投稿をインポート」への再試行文言を含む', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ mode: 'backfill', synced: 10, stoppedReason: 'time_budget' })
    );
    expect(message.type).toBe('warning');
    expect(message.message).toContain('過去の投稿をインポート');
  });

  it('backfill 完了時は success を返す', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ mode: 'backfill', synced: 5, backfillCompleted: true })
    );
    expect(message.type).toBe('success');
    expect(message.message).toContain('完了');
  });

  it('backfill が truncated（続きあり）のときは info を返す', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ mode: 'backfill', synced: 50, truncated: true })
    );
    expect(message.type).toBe('info');
    expect(message.message).toContain('続きがあります');
  });

  it('rate_limit 中断はモードに関わらず同じ warning を返す', () => {
    const message = getInstagramSyncToastMessage(
      baseResult({ mode: 'backfill', stoppedReason: 'rate_limit' })
    );
    expect(message.type).toBe('warning');
    expect(message.message).toContain('利用上限');
  });
});
