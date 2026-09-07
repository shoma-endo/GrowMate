/**
 * AI 要約の対象項目と一括実行の結果型。
 *
 * **`src/lib/` に置く。** クライアントコンポーネント（`CategoryFilter` / `AnalyticsClient`）が
 * 値として参照するため、`src/server/lib/` に置くと層が逆転する。いまは当該ファイルが純粋で
 * `server-only` も付いていないので壊れていないが、そこに server-only な import が1つ入った
 * 瞬間にクライアントビルドが壊れる。
 */

/**
 * AI 要約が書き込む8項目（`content-annotation-bulk-ai-summary-spec.md` BR-02）。
 * `impressions` は `saveSummary` の更新対象外なので未要約判定に含めない。
 * 順序は仕様書 BR-02 の記載順に揃える。
 */
export const SUMMARY_TARGET_FIELD_KEYS = [
  'main_kw',
  'kw',
  'needs',
  'persona',
  'goal',
  'prep',
  'opening_proposal',
  'basic_structure',
] as const;

export type SummaryTargetFieldKey = (typeof SUMMARY_TARGET_FIELD_KEYS)[number];

/**
 * 一括要約の失敗理由。単記事コアの `SummaryErrorCode` を包含し、一括だけで起きる理由を足す。
 * 包含関係がずれると内訳が「その他」に落ちるので、`tests/unit/lib/...` で型レベルの包含を固定する。
 */
const SUMMARY_FAILURE_CODES = [
  'SUMMARY_SOURCE_NOT_LINKED',
  'SUMMARY_CONTENT_FETCH_FAILED',
  'SUMMARY_CONTENT_TOO_LARGE',
  'SUMMARY_AI_FAILED',
  // Anthropic のレート制限（429）。単記事コアの SummaryErrorCode にもある
  'SUMMARY_AI_RATE_LIMITED',
  // WordPress の連携が切れていて Cookie 無しでは本文を取得できない。
  // **一括専用**（単記事コアの SummaryErrorCode には足さない）。
  // ジョブ処理サービスが「本文取得の可否判定」の結果で
  // SUMMARY_CONTENT_FETCH_FAILED から読み替えて計上する
  'SUMMARY_WP_REAUTH_REQUIRED',
  'SUMMARY_PARSE_FAILED',
  'ANNOTATION_NOT_FOUND',
  'EMPTY_SUMMARY',
  'ITEM_TIME_LIMIT',
  'SAVE_FAILED',
  'NOT_OWNED',
  'UNEXPECTED',
] as const;

export type SummaryFailureCode = (typeof SUMMARY_FAILURE_CODES)[number];
