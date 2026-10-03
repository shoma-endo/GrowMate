import type { InstagramBlogDraftListItem } from '@/types/instagram';

/**
 * 待機中・作成中のまま `updated_at` がこれより古い行を「止まった」とみなす。
 * 画面の表示・開始の 409・再開の対象の3つがこの値で一致している前提（仕様 FR-001 手順3・FR-007）。
 * 20 分は一括 AI 要約の止まった判定と同じ値（maxDuration 800 秒に 15 分では余裕が足りないため）
 */
export const INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS = 20 * 60 * 1000;

/** 1回の［ブログ記事を作成］で選べる投稿の上限（画面の活性判定とサーバーの入力検証で共用） */
export const INSTAGRAM_BLOG_DRAFT_MAX_SELECTION = 10;

export function isInstagramBlogDraftStalled(
  draft: Pick<InstagramBlogDraftListItem, 'status' | 'updatedAt'>,
  now: number
): boolean {
  return (
    (draft.status === 'queued' || draft.status === 'running') &&
    now - Date.parse(draft.updatedAt) > INSTAGRAM_BLOG_DRAFT_STALE_AFTER_MS
  );
}

/**
 * 進み具合 n/m。m は「キーワード案 1 + step1〜6 の 6 + 見出しの数 + 完成形 1」（仕様 FR-008）。
 * 見出しの数が決まるまでは m を出さない
 */
export function getInstagramBlogDraftProgress(
  draft: Pick<InstagramBlogDraftListItem, 'stage' | 'headingIndex' | 'headingTotal'>
): { done: number; total: number } | null {
  if (draft.headingTotal === null) return null;
  const total = draft.headingTotal + 8;
  switch (draft.stage) {
    case 'keywords':
      return { done: 0, total };
    case 'step1':
    case 'step2':
    case 'step3':
    case 'step4':
    case 'step5':
    case 'step6':
      return { done: Number(draft.stage.slice(4)), total };
    case 'headings':
      return { done: 7, total };
    case 'heading':
      return { done: 7 + draft.headingIndex, total };
    case 'combine':
      return { done: total - 1, total };
    case 'done':
      return { done: total, total };
  }
}

export type InstagramBlogDraftDisplayState =
  | { kind: 'none' }
  | { kind: 'queued' }
  | { kind: 'running'; progress: string | null }
  | { kind: 'stopped'; label: '失敗' | '途中で切れました'; progress: string | null }
  | { kind: 'completed' };

export function getInstagramBlogDraftDisplayState(
  draft: InstagramBlogDraftListItem | null,
  now: number
): InstagramBlogDraftDisplayState {
  if (!draft) return { kind: 'none' };
  if (draft.status === 'completed') return { kind: 'completed' };

  const counts = getInstagramBlogDraftProgress(draft);
  const progress = counts === null ? null : `${counts.done}/${counts.total}`;
  if (draft.status === 'failed' || isInstagramBlogDraftStalled(draft, now)) {
    return {
      kind: 'stopped',
      label: draft.errorCode === 'MAX_TOKENS' ? '途中で切れました' : '失敗',
      progress,
    };
  }
  if (draft.status === 'queued') return { kind: 'queued' };
  return { kind: 'running', progress };
}
