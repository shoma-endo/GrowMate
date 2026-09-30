import { sanitizeEmailHtml } from '@/server/lib/email-html';
import type { InstagramBlogDraftErrorCode } from '@/types/instagram';

export interface InstagramBlogDraftEmailJob {
  status: 'completed' | 'failed';
  errorCode: InstagramBlogDraftErrorCode | null;
  sessionId: string | null;
  mainKeyword: string | null;
  caption: string;
}

export interface InstagramBlogDraftEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildInstagramBlogDraftEmail(
  siteUrl: string,
  jobs: InstagramBlogDraftEmailJob[]
): InstagramBlogDraftEmailContent {
  const completedCount = jobs.filter(job => job.status === 'completed').length;
  const stoppedCount = jobs.length - completedCount;
  const subject = stoppedCount === 0
    ? `【GrowMate】ブログ記事ができました（${completedCount}件）`
    : `【GrowMate】ブログ記事の作成が終わりました（完了 ${completedCount}件・止まった ${stoppedCount}件）`;
  const rows = jobs.map(job => {
    const keyword = job.mainKeyword || job.caption.slice(0, 30);
    const sessionId = job.sessionId;
    if (job.status === 'completed') {
      if (!sessionId) return `<li>${escapeHtml(keyword)}: できました</li>`;
      const href = `${siteUrl}/chat?session=${encodeURIComponent(sessionId)}&initialStep=step7`;
      return `<li>${escapeHtml(keyword)}: できました — <a href="${escapeHtml(href)}">チャットを開く</a></li>`;
    }
    const text = job.errorCode === 'MAX_TOKENS'
      ? 'AI の出力が途中で切れました。［続きを作成］で続きだけを生成できます'
      : 'AI の呼び出しなどに失敗しました。Instagram タブの［続きを作成］で止まったところから作れます';
    return `<li>${escapeHtml(keyword)}: ${escapeHtml(text)} — <a href="${escapeHtml(`${siteUrl}/analytics?tab=instagram`)}">Instagram タブを開く</a></li>`;
  });
  const html = sanitizeEmailHtml(`<div><p>選んだ投稿のブログ記事作成が終わりました。</p><ul>${rows.join('')}</ul></div>`);
  return { subject, html };
}
