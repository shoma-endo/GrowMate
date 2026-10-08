import { sanitizeEmailHtml } from '@/server/lib/email-html';

export interface InstagramBlogDraftEmailJob {
  status: 'completed' | 'failed';
  sessionId: string | null;
  mainKeyword: string | null;
  caption: string;
  postedAt: string | null;
}

export interface InstagramBlogDraftEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 一覧（Instagram タブ）の投稿日と同じ「2022/9/9 投稿」。サーバーは UTC で動くので日本時間に直す */
function formatPostedDate(postedAt: string | null): string | null {
  if (!postedAt) return null;
  const date = new Date(postedAt);
  if (Number.isNaN(date.getTime())) return null;
  const ymd = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(date);
  return `${ymd} 投稿`;
}

/**
 * 件数と、作った記事の一覧を知らせる。記事名は主軸kw（自動作成の記事は WordPress のタイトルを持たない）。
 * 同じ事業の投稿は主軸kw がそろいやすいので、元の投稿の投稿日を添えて見分けられるようにする
 */
export function buildInstagramBlogDraftEmail(
  siteUrl: string,
  jobs: InstagramBlogDraftEmailJob[]
): InstagramBlogDraftEmailContent {
  const completed = jobs.filter(job => job.status === 'completed').length;
  const failed = jobs.length - completed;
  const instagramTabHref = `${siteUrl}/analytics?tab=instagram`;
  const summary = failed === 0
    ? `ブログ記事の生成が終わりました（完了 ${completed}件）。`
    : `ブログ記事の生成が終わりました（完了 ${completed}件・失敗 ${failed}件）。失敗した記事は Instagram タブの［続きを作成］で続きから作れます。`;
  const rows = jobs.map(job => {
    const title = escapeHtml(job.mainKeyword || job.caption.slice(0, 30) || '（タイトルなし）');
    const postedDate = formatPostedDate(job.postedAt);
    const suffix = postedDate ? `（${escapeHtml(postedDate)}）` : '';
    if (job.status === 'completed' && job.sessionId) {
      const href = `${siteUrl}/chat?session=${encodeURIComponent(job.sessionId)}&initialStep=step7`;
      return `<li><a href="${escapeHtml(href)}">${title}</a>${suffix}</li>`;
    }
    return `<li>${title}${suffix}: ${job.status === 'completed' ? '完了' : '失敗'}</li>`;
  });
  const html = sanitizeEmailHtml(
    `<div><p>${summary}</p><ul>${rows.join('')}</ul><p><a href="${escapeHtml(instagramTabHref)}">Instagram タブを開く</a></p></div>`
  );
  return { subject: '【GrowMate】ブログ記事生成完了', html };
}
