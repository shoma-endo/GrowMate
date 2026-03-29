// Google Search Console evaluation interval configuration
// Default: 30 days (per product spec). Future-proofed for per-user overrides.

const DEFAULT_INTERVAL_DAYS = 30;
const DEFAULT_QUERY_ROW_LIMIT = 1000;
const DEFAULT_QUERY_MAX_PAGES = 10;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getGscQueryRowLimit(): number {
  const raw = process.env.GSC_QUERY_ROW_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_QUERY_ROW_LIMIT;
  }
  return clampNumber(parsed, 1, 25000);
}

export function getGscQueryMaxPages(): number {
  return DEFAULT_QUERY_MAX_PAGES;
}
