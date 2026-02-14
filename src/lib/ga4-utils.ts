export const GA4_EVENT_SCROLL_90 = 'scroll_90';

export function normalizeToPath(input: string | null | undefined): string {
  if (!input) return '/';
  const trimmed = input.trim();
  if (!trimmed) return '/';

  const lowered = trimmed.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');

  if (lowered.startsWith('?') || lowered.startsWith('#')) {
    return '/';
  }

  let pathCandidate = lowered;
  if (!lowered.startsWith('/')) {
    const slashIndex = lowered.indexOf('/');
    if (slashIndex >= 0) {
      pathCandidate = lowered.slice(slashIndex);
    } else {
      return '/';
    }
  }

  const withoutFragment = pathCandidate.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';

  if (!withoutQuery) return '/';

  const stripped = withoutQuery.replace(/\/+$/g, '');
  if (!stripped) return '/';
  return stripped === '/' ? '/' : stripped;
}

export function ga4DateStringToIso(dateString: string): string {
  if (!/^\d{8}$/.test(dateString)) {
    return dateString;
  }
  return `${dateString.slice(0, 4)}-${dateString.slice(4, 6)}-${dateString.slice(6, 8)}`;
}

// 日付ロジックは date-utils に集約（JST フォールバック含む）
export { formatJstDateISO, getJstDateISOFromTimestamp } from '@/lib/date-utils';
