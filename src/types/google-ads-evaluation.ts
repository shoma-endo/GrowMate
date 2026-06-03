/**
 * Google Ads AI 分析設定
 */
export interface GoogleAdsEvaluationSettings {
  /** 分析対象期間の日数。1 以上 365 以下の整数を使用する。例: 30 */
  dateRangeDays: number;
  /** 最終成功実行日。`YYYY-MM-DD` 形式の JST 日付文字列、未実行時は null。 */
  lastEvaluatedOn: string | null;
}

export interface GoogleAdsEvaluationSettingsRecord extends GoogleAdsEvaluationSettings {
  userId: string;
}

export interface UpdateGoogleAdsEvaluationSettingsInput {
  dateRangeDays?: number;
}

export interface UpsertGoogleAdsEvaluationSettingsInput {
  userId: string;
  dateRangeDays?: number;
  lastEvaluatedOn?: string | null;
}

export interface GoogleAdsAiAnalysisResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * §17: 既存コンテンツ在庫（WordPress 由来の実在記事）の1件。
 * カニバリ判定（新規 vs 修正）のために LLM へ渡す。
 */
export interface ContentInventoryItem {
  id: string;
  title: string;
  /** canonical_url 優先・無ければ normalized_url */
  url: string;
  mainKw: string | null;
  kw: string | null;
  categoryNames: string[];
  /** wp_content_text の先頭抜粋（フル本文は渡さない） */
  excerpt: string;
}

/**
 * §17 Increment2: AI 出力末尾に併出される TOP5 提案の最小 JSON。
 * メール順位表をコード側で機械生成する（捏造防止）ための KW 抽出に使う。
 * フェーズ2の構造化データ（DB保存）とは別物で、MVP では DB 保存しない。
 */
export interface TopProposalKeyword {
  rank: number;
  mainKw: string;
  subKws: string[];
}

/**
 * §17: GSC（自社順位）スナップショットの1件。
 * URL/タイトルは content_annotation_id（FK）経由で content_annotations に突合する。
 */
export interface RankingSnapshotItem {
  queryNormalized: string;
  position: number;
  impressions: number;
  clicks: number;
  /** content_annotations 突合済み URL。未突合（WP未取込）は GSC の normalized_url にフォールバック */
  url: string;
  /** content_annotations.wp_post_title。未突合時は空文字 */
  title: string;
  contentAnnotationId: string | null;
}
