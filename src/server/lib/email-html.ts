/**
 * メール本文向けのHTML無害化。script/style/コメント/on*属性/javascript:リンク/
 * 埋め込み系タグを除去する。googleAdsAiAnalysisService.ts・
 * googleAdsNegativeKeywordsSuggestionService.ts・ga4ContentEvaluationCycleService.ts
 * (§9.5) の3箇所から共通利用する（docs/plans/ga4-content-evaluation-spec.md §17 共通化candidate）。
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
    .replace(/<\/?(iframe|object|embed|form|input|button)[^>]*>/gi, '');
}
