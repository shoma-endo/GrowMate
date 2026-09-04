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

/** 一括実行の結果件数（4カテゴリ）。統合カウンタにしない理由は仕様 §6 出力を参照 */
export interface BulkSummaryResult {
  /** 要約が成功し、8項目のいずれかが非空で保存された件数 */
  succeededCount: number;
  /** 本文取得失敗・LLM 失敗・パース失敗・8項目すべて空 */
  failedCount: number;
  /**
   * 失敗の内訳（理由コードごとの件数）。合計は `failedCount` と一致する。
   *
   * **件数だけ返すと利用者は原因を知りようがない。** サーバーは理由を特定できているのに
   * UI へ渡す前に捨てていた（`console.error` はサーバーログにしか出ない）ので、
   * 「本文が長すぎるか WordPress から取得できていません」のような**当て推量の案内**しか
   * 出せなかった。原因と次のアクションをセットで見せるために内訳を返す。
   */
  failedByCode: Partial<Record<SummaryFailureCode, number>>;
  /** 実行時点で BR-02 を満たさなかった件数（入力済み、または WordPress 未連携）。再実行しても対象外 */
  skippedCount: number;
  /** 時間予算切れで着手しなかった件数（BR-03）。再実行すれば進む */
  unprocessedCount: number;
  stoppedReason: BulkSummaryStoppedReason;
}

type BulkSummaryStoppedReason = 'completed' | 'time_budget';
