import { describe, expect, it } from 'vitest';
import {
  getInstagramBlogDraftDisplayState,
  getInstagramBlogDraftProgress,
  isInstagramBlogDraftStalled,
} from '@/lib/instagram-blog-draft';
import type { InstagramBlogDraftListItem } from '@/types/instagram';

const draft: InstagramBlogDraftListItem = {
  id: 'job-1',
  sessionId: 'session-1',
  status: 'running',
  stage: 'heading',
  headingIndex: 3,
  headingTotal: 15,
  errorCode: null,
  updatedAt: '2026-09-30T00:00:00.000Z',
};

describe('Instagram blog draft display state', () => {
  it('20分ちょうどは進行中、20分を超えると停止扱い', () => {
    const updatedAt = Date.parse(draft.updatedAt);
    expect(isInstagramBlogDraftStalled(draft, updatedAt + 20 * 60_000)).toBe(false);
    expect(isInstagramBlogDraftStalled(draft, updatedAt + 20 * 60_000 + 1)).toBe(true);
  });

  it('停止・失敗・完了の表示を判定する', () => {
    expect(getInstagramBlogDraftDisplayState(draft, Date.parse(draft.updatedAt) + 20 * 60_000 + 1))
      .toEqual({ kind: 'stopped', label: '失敗', progress: '10/23', resumable: true });
    expect(getInstagramBlogDraftDisplayState({ ...draft, status: 'failed', errorCode: 'MAX_TOKENS' }, 0))
      .toEqual({ kind: 'stopped', label: '途中で切れました', progress: '10/23', resumable: true });
    expect(getInstagramBlogDraftDisplayState({ ...draft, status: 'completed' }, 0))
      .toEqual({ kind: 'completed' });
  });

  it('チャットが削除された（sessionId が null）止まった作成は、キーワード案の段階のときだけ再開できる', () => {
    const failed = { ...draft, status: 'failed' as const, sessionId: null };
    expect(getInstagramBlogDraftDisplayState(failed, 0)).toMatchObject({ kind: 'stopped', resumable: false });
    expect(getInstagramBlogDraftDisplayState({ ...failed, stage: 'step3', headingTotal: null }, 0))
      .toMatchObject({ kind: 'stopped', resumable: false });
    expect(getInstagramBlogDraftDisplayState({ ...failed, stage: 'keywords', headingTotal: null }, 0))
      .toMatchObject({ kind: 'stopped', resumable: true });
  });

  // m = キーワード案 1 + step1〜6 + 見出しの数 + 完成形 1。n は保存を終えたステップの数
  it.each([
    ['keywords', 0, null, null],
    ['step3', 0, null, null],
    ['keywords', 0, 2, { done: 0, total: 10 }],
    ['step1', 0, 2, { done: 1, total: 10 }],
    ['step6', 0, 2, { done: 6, total: 10 }],
    ['headings', 0, 2, { done: 7, total: 10 }],
    ['heading', 1, 2, { done: 8, total: 10 }],
    ['combine', 2, 2, { done: 9, total: 10 }],
    ['done', 2, 2, { done: 10, total: 10 }],
  ] as const)('stage %s・見出し %i/%s の進み具合は %j', (stage, headingIndex, headingTotal, expected) => {
    expect(getInstagramBlogDraftProgress({ stage, headingIndex, headingTotal })).toEqual(expected);
  });
});
