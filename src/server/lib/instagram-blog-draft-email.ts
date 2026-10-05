import { sanitizeEmailHtml } from '@/server/lib/email-html';

export interface InstagramBlogDraftEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 終わったことと件数だけを知らせる。投稿ごとの結果は Instagram タブの操作列で見る */
export function buildInstagramBlogDraftEmail(
  siteUrl: string,
  counts: { completed: number; failed: number }
): InstagramBlogDraftEmailContent {
  const href = `${siteUrl}/analytics?tab=instagram`;
  const summary = counts.failed === 0
    ? `ブログ記事の生成が終わりました（完了 ${counts.completed}件）。結果は Instagram タブで確認できます。`
    : `ブログ記事の生成が終わりました（完了 ${counts.completed}件・失敗 ${counts.failed}件）。失敗した記事は Instagram タブの［続きを作成］で続きから作れます。`;
  const html = sanitizeEmailHtml(
    `<div><p>${summary}</p><p><a href="${escapeHtml(href)}">Instagram タブを開く</a></p></div>`
  );
  return { subject: '【GrowMate】ブログ記事生成完了', html };
}
