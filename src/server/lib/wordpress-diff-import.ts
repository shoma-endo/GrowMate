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
  const oldTypes = normalizeContentTypes(previous.wp_content_types).sort();
  const newTypes = normalizeContentTypes(next.wpContentTypes).sort();
  return previous.wp_type !== next.wpType ||
    previous.wp_site_url !== next.wpSiteUrl ||
    previous.wp_site_id !== next.wpSiteId ||
    oldTypes.length !== newTypes.length ||
    oldTypes.some((type, index) => type !== newTypes[index]);
}

export function classifyWordPressImportFailure(
  error: unknown,
  tokenRefreshFailed = false
): 'auth_expired' | 'temporary_failure' {
  if (tokenRefreshFailed) return 'auth_expired';
  if (error && typeof error === 'object' && 'statuses' in error) {
    const { statuses } = error as { statuses?: unknown };
    if (Array.isArray(statuses) && statuses.some(status => status === 401 || status === 403)) {
      return 'auth_expired';
    }
  }
  return 'temporary_failure';
}
