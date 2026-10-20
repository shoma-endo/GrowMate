import { normalizeContentTypes } from '@/server/services/wordpressContentTypes';

export function isChangedSinceBaseline(
  post: { modified_gmt?: string; date_gmt?: string },
  baseline: string | null
): boolean {
  if (!baseline) return true;
  const baselineTime = new Date(baseline).getTime();
  return [post.modified_gmt, post.date_gmt].some(value => value !== undefined && parseGmtDate(value) > baselineTime);
}

function parseGmtDate(value: string): number {
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Date(withTimezone).getTime();
}

export function hasWordPressImportTargetChanged(
  previous: {
    wp_type: string | null;
    wp_site_url: string | null;
    wp_site_id: string | null;
    wp_content_types: string[] | null;
  } | null,
  next: {
    wpType: string | null;
    wpSiteUrl: string | null;
    wpSiteId: string | null;
    wpContentTypes: string[] | null;
  }
): boolean {
  if (!previous) return true;
  const oldTypes = new Set(normalizeContentTypes(previous.wp_content_types));
  // 投稿タイプを外すだけなら、残りのタイプは差分取込を続けられる。足したタイプは基準より前の記事を
  // 取り込んでいないので、全件取得に戻すために基準をリセットする
  const typeAdded = normalizeContentTypes(next.wpContentTypes).some(type => !oldTypes.has(type));
  return previous.wp_type !== next.wpType ||
    previous.wp_site_url !== next.wpSiteUrl ||
    previous.wp_site_id !== next.wpSiteId ||
    typeAdded;
}

/** 一時的な失敗がこの日数続いたら、マイホームで知らせる（FR-012） */
const WORDPRESS_IMPORT_STALLED_DAYS = 3;

/**
 * WordPress の自動取込が「一時的な失敗」のまま止まっているか（FR-012）。
 * 最後に最後まで取り込めた回は差分の基準（その回の開始時刻）で分かる。一度も取り込めていなければ、
 * 連携した日から数える。手動の一括インポートで最後まで取り込めた場合も基準が進むので、知らせは消える。
 */
export function isWordPressImportStalled(
  settings: { autoImportStatus: string | null; importBaselineAt: string | null; createdAt: string | null },
  now: number
): boolean {
  if (settings.autoImportStatus !== 'temporary_failure') return false;
  const lastProgressAt = settings.importBaselineAt ?? settings.createdAt;
  if (!lastProgressAt) return false;
  const elapsed = now - new Date(lastProgressAt).getTime();
  return elapsed >= WORDPRESS_IMPORT_STALLED_DAYS * 24 * 60 * 60 * 1000;
}

export function classifyWordPressImportFailure(error: unknown): 'auth_expired' | 'temporary_failure' {
  if (error && typeof error === 'object' && 'statuses' in error) {
    const { statuses } = error as { statuses?: unknown };
    // 401 は認証情報が無効になった。403 は、別の候補 URL がサイトの失敗（0・5xx）なら、その形式が
    // ファイアウォール等で使えないだけのことがあり、再連携では直らないので認証切れにしない
    if (Array.isArray(statuses)) {
      const siteFailure = statuses.some(status => status === 0 || status >= 500);
      if (statuses.includes(401) || (statuses.includes(403) && !siteFailure)) return 'auth_expired';
    }
  }
  return 'temporary_failure';
}
