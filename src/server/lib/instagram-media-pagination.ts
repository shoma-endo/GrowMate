export interface InstagramMediaPageResponse {
  data?: unknown;
  paging?: unknown;
}

export interface InstagramMediaPaginationResult {
  items: unknown[];
  truncated: boolean;
  pagesFetched: number;
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
      break;
    }

    items = [...items, ...pageData];

    if (pageData.length === 0) {
      break;
    }

    const afterCursor = extractInstagramMediaAfterCursor(page.paging);
    if (!afterCursor) {
      break;
    }
  }

  return { items, truncated, pagesFetched };
}
