import { sanitizeEmailHtml } from '@/server/lib/email-html';

export interface InstagramBlogDraftEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 終わったことだけを知らせる。投稿ごとの結果は Instagram タブの操作列で見る */
export function buildInstagramBlogDraftEmail(siteUrl: string): InstagramBlogDraftEmailContent {
  const href = `${siteUrl}/analytics?tab=instagram`;
  const html = sanitizeEmailHtml(
    `<div><p>ブログ記事の生成が終わりました。結果は Instagram タブで確認できます。</p><p><a href="${escapeHtml(href)}">Instagram タブを開く</a></p></div>`
  );
  return { subject: '【GrowMate】ブログ記事生成完了', html };
}
