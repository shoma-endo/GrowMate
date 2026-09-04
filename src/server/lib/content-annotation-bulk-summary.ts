import {
  CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS,
  CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS,
} from '@/lib/constants';
import {
  SUMMARY_TARGET_FIELD_KEYS,
  type SummaryTargetFieldKey,
} from '@/lib/content-annotation-summary-fields';
import type { AnnotationRecord } from '@/types/annotation';

// 型と定数の正本は src/lib/content-annotation-summary-fields.ts（クライアントも読むため）。
// 既存の import 経路を壊さないよう、サーバー側からは本ファイル経由でも取れるようにしておく
export {
  SUMMARY_TARGET_FIELD_KEYS,
  type SummaryTargetFieldKey,
  type SummaryFailureCode,
} from '@/lib/content-annotation-summary-fields';

/**
 * AI 要約一括実行の純粋ロジック。
 * 正本: docs/plans/content-annotation-bulk-ai-summary-spec.md
 */

const readField = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * 8項目がすべて空か（NULL / 空文字 / 空白のみを同一視）。
 * SQL 側の述語（`20260831000000_add_unsummarized_filter_...sql`）と同じ判定にする。
 */
export function isSummaryEmpty(annotation: Partial<AnnotationRecord>): boolean {
  return SUMMARY_TARGET_FIELD_KEYS.every(key => readField(annotation[key]) === '');
}

/**
 * WordPress 連携済みか（BR-02）。単記事要約の活性化条件と同型。
 */
export function isWordPressLinkedForSummary(annotation: Partial<AnnotationRecord>): boolean {
  const wpPostId = annotation.wp_post_id;
  if (typeof wpPostId === 'number' && Number.isFinite(wpPostId) && wpPostId > 0) return true;
  return readField(annotation.canonical_url) !== '';
}

/** 生成結果の8項目がすべて空なら成功にしない（AC-04b） */
export function isGeneratedSummaryEmpty(fields: Partial<Record<SummaryTargetFieldKey, string | null>>): boolean {
  return SUMMARY_TARGET_FIELD_KEYS.every(key => readField(fields[key]) === '');
}

/**
 * 処理順序を `updated_at` 昇順（同値は `id` 昇順でタイブレーク）に並べる。
 *
 * 降順のままだと、WordPress 本文取得に成功して `updated_at` だけ最新化された失敗記事が
 * 次回実行でキュー先頭に戻る。本文サイズ超過は本文が縮まない限り毎回必ず失敗する決定的失敗なので、
 * 先頭に溜まると再実行の前進件数が 0 になりうる（仕様 §6 実行順序 / R-001）。
 */
export function orderTargetsForProcessing<T extends { id: string; updated_at?: string | null }>(
  targets: readonly T[]
): T[] {
  return [...targets].sort((a, b) => {
    const au = a.updated_at ?? '';
    const bu = b.updated_at ?? '';
    if (au !== bu) {
      // updated_at が無い行は最も古いものとして先に処理する
      if (au === '') return -1;
      if (bu === '') return 1;
      return au < bu ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 残り時間から1件分の予算を算出する。着手できないときは null を返し、呼び出し側は
 * 未実行件数へ計上する（`googleAdsAiAnalysisService.computeLlmTimeoutMs` と同型だが、
 * 例外ではなく null で返す）。
 *
 * `itemMs` は WordPress 本文取得を含む1件全体の上限。**LLM だけに上限を掛けても足りない**:
 * 本文取得（`fetchWpPostContentLive` → `wordpressService` の fetch）にはタイムアウトが無く、
 * LLM 呼び出しより前にあるため、ここがハングすると maxDuration でハードキルされる。
 * 成功分は1件ずつコミット済みなのにレスポンスが返らず、件数通知が丸ごと失われる。
 *
 * `llmMs` は LLM 呼び出しに渡す値で、1件全体の上限から本文取得の分を引いた値。
 * 着手の下限が「本文取得 + LLM 最低」なので、`llmMs` は常に LLM 最低予算以上になる。
 *
 * 下限（`MIN_ITEM_BUDGET_MS` = 本文取得 + LLM 最低）を割ったら着手しない。下限を LLM 分だけで
 * 決めると、下限ぎりぎりで着手した1件は本文取得に使える時間が 0 になり必ずタイムアウトする。
 * Claude への課金は発生し、`updateContentCache` が `updated_at` を進めたうえで、
 * 「再実行すれば進む未実行」であるべきものが「失敗」に化ける（仕様 §6 の4カテゴリの意味が壊れる）。
 */
export function computeSummaryItemBudgetMs(
  elapsedMs: number
): { itemMs: number; llmMs: number } | null {
  const remainingMs =
    CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
    elapsedMs -
    CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS;
  if (remainingMs < CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS) return null;

  const itemMs = Math.min(
    remainingMs,
    CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS + CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS
  );
  // 下限が「本文取得 + LLM 最低」なので、ここは必ず MIN_LLM_BUDGET_MS 以上になる。
  // clamp を入れると itemMs を超える llmMs を返しうるので入れない
  const llmMs = itemMs - CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS;
  return { itemMs, llmMs };
}
