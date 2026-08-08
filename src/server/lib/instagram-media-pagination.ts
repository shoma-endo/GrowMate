export interface InstagramMediaPageResponse {
  data?: unknown;
  paging?: unknown;
}

export interface InstagramMediaPaginationResult {
  items: unknown[];
  truncated: boolean;
  pagesFetched: number;
  /** 次回このカーソルで再開すると続きから取得できる。null はこれ以上ページがない（アカウント末端） */
  nextCursor: string | null;
}

export function extractInstagramMediaAfterCursor(paging: unknown): string | null {
  if (typeof paging !== 'object' || paging === null) {
    return null;
  }
  const after = (paging as { cursors?: { after?: unknown } }).cursors?.after;
  if (typeof after === 'string' && after.length > 0) {
    return after;
  }
  return null;
}

export function collectInstagramMediaPages(
  pages: InstagramMediaPageResponse[],
  maxItems: number
): InstagramMediaPaginationResult {
  let items: unknown[] = [];
  let truncated = false;
  let pagesFetched = 0;
  let nextCursor: string | null = null;

  for (const page of pages) {
    pagesFetched += 1;
    const pageData = Array.isArray(page.data) ? page.data : [];
    const remaining = maxItems - items.length;

    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (pageData.length > remaining) {
      items = [...items, ...pageData.slice(0, remaining)];
      truncated = true;
      // ページサイズ（呼び出し元で 25 指定）が maxItems（既定 50）の約数である限り、
      // 通常運用ではこの分岐に到達しない想定。到達した場合でも Graph API のカーソルは
      // 「このページの後続」を指すため、remaining 件に間引いても次回再開位置として有効。
      nextCursor = extractInstagramMediaAfterCursor(page.paging);
      break;
    }

    items = [...items, ...pageData];

    if (pageData.length === 0) {
      nextCursor = null;
      break;
    }

    nextCursor = extractInstagramMediaAfterCursor(page.paging);
    if (!nextCursor) {
      break;
    }
  }

  return { items, truncated, pagesFetched, nextCursor };
}
