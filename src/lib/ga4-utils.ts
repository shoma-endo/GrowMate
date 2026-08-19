/**
 * 90%スクロール到達とみなすイベント名の候補（優先順）。
 *
 * 拡張計測を有効にした GA4 は標準で `scroll`（90%到達で発火・追加設定不要）を送る。
 * `scroll_90` は独自にカスタムイベントを設定しているプロパティ向け。
 * 両方が存在するプロパティでは同じ行動を二重計上しないよう、先に見つかった1つだけを採用する。
 */
export const GA4_SCROLL_EVENT_NAMES: readonly string[] = ['scroll_90', 'scroll'];

/**
 * レポートに実際に現れたイベント名から、このプロパティで採用するスクロールイベントを1つ決める。
 *
 * 返り値が `null` のときは「対象イベントがプロパティに存在せず未計測」であり、
 * 完読率を 0% として扱ってはいけない（0＝実測して0回、とは区別する。BR-02）。
 * 0 と混同すると、読了スコア40未満の記事が計測していない完読率を根拠に
 * 診断コード `R_TOP_EXIT` へ強制上書きされる。
 */
export function resolveGa4ScrollEventName(
  observedEventNames: Iterable<string | null | undefined>
): string | null {
  const observed = new Set<string>();
  for (const name of observedEventNames) {
    if (name) observed.add(name);
  }
  return GA4_SCROLL_EVENT_NAMES.find(name => observed.has(name)) ?? null;
}

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
