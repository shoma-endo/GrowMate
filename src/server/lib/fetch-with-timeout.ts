import 'server-only';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * AbortController ベースのタイムアウト付き fetch。
 * 外部 API 呼び出し（Instagram Graph API、CDN からの画像ダウンロード等）で共通利用する。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
