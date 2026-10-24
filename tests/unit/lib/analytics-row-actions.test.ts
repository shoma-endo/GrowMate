import { describe, expect, it } from 'vitest';
import { getAnalyticsRowActions } from '@/lib/analytics-row-actions';

const base = {
  annotationId: 'a1',
  sessionId: 's1',
  wpPostId: null,
  wpPostStatus: null,
  hasUnreadSuggestion: false,
};

describe('getAnalyticsRowActions', () => {
  it('未送信の行は WordPress に投稿でき、詳細はメニューに入る', () => {
    expect(getAnalyticsRowActions(base)).toEqual({
      canPublishToWordPress: true,
      detailPlacement: 'menu',
    });
  });

  it('公開済みの行は WordPress に投稿を出さない', () => {
    expect(
      getAnalyticsRowActions({ ...base, wpPostId: 10, wpPostStatus: 'publish' }).canPublishToWordPress
    ).toBe(false);
  });

  it('下書き・予約の行は再送できる', () => {
    expect(
      getAnalyticsRowActions({ ...base, wpPostId: 10, wpPostStatus: 'draft' }).canPublishToWordPress
    ).toBe(true);
    expect(
      getAnalyticsRowActions({ ...base, wpPostId: 10, wpPostStatus: 'future' }).canPublishToWordPress
    ).toBe(true);
  });

  it('取込由来でチャットのセッションが無い行は WordPress に投稿を出さない', () => {
    expect(getAnalyticsRowActions({ ...base, sessionId: null }).canPublishToWordPress).toBe(false);
  });

  it('未読の改善提案がある行は、詳細を行に出す', () => {
    expect(
      getAnalyticsRowActions({
        ...base,
        wpPostId: 10,
        wpPostStatus: 'draft',
        hasUnreadSuggestion: true,
      })
    ).toEqual({ canPublishToWordPress: true, detailPlacement: 'row' });
  });

  it('記事データが無い行は WordPress に投稿も詳細も出さない', () => {
    expect(
      getAnalyticsRowActions({
        annotationId: null,
        sessionId: null,
        wpPostId: null,
        wpPostStatus: null,
        hasUnreadSuggestion: false,
      })
    ).toEqual({ canPublishToWordPress: false, detailPlacement: null });
  });
});
