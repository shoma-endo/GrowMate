export const WORDPRESS_CONTENT_TYPE_LABELS = { posts: '投稿', pages: '固定ページ' } as const;

/** 送り直しても通らない、または WordPress に二重に作られうる recovery。送信ボタンは出したまま押せなくする */
const BLOCKING_RECOVERIES: ReadonlySet<string> = new Set(['close', 'open_chat', 'setup', 'relink']);

export function isWordPressPublishBlocked({ info, recovery }: { info: string; recovery: string }): boolean {
  return Boolean(info) || BLOCKING_RECOVERIES.has(recovery);
}
