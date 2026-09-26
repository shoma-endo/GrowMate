import type { AnnotationRecord } from '@/types/annotation';
import type { Ga4PageMetricSummary } from '@/types/ga4';

export interface AnalyticsContentItem {
  rowKey: string;
  annotation: AnnotationRecord;
  ga4Summary?: Ga4PageMetricSummary | null;
  ga4Evaluation?: {
    status: string | null;
    contentScore: number | null;
    diagnosisCode: string | null;
    lastEvaluatedAt: string | null;
  };
}

/**
 * ブログ一覧の列見出しで並べ替えできる列（＝一覧の列 id。RPC の `p_sort_key` にそのまま渡す）。
 * 型 `AnalyticsContentSortKey` と許可リスト（`isAnalyticsSortKey`）はここから作る。
 * 列を足すときはここと `get_filtered_content_annotations` の許可リストを直す。
 */
export const ANALYTICS_CONTENT_SORT_KEYS = [
  'impressions',
  'ga4_avg_engagement_time',
  'ga4_read_rate',
  'ga4_engagement_rate',
  'ga4_evaluation_status',
  'ga4_content_score',
  'ga4_cv_count',
  'ga4_cvr',
] as const;
export type AnalyticsContentSortKey = (typeof ANALYTICS_CONTENT_SORT_KEYS)[number];

/** 並べ替え中の列と向き。null は並べ替えなし（更新日の新しい順） */
export type AnalyticsContentSort = {
  key: AnalyticsContentSortKey;
  order: 'asc' | 'desc';
} | null;

export interface AnalyticsContentQuery {
  page: number;
  perPage: number;
  startDate: string;
  endDate: string;
  selectedCategoryNames?: string[];
  includeUncategorized?: boolean;
  hasUnreadSuggestion?: boolean;
  /**
   * 「評価未設定」＝評価サイクルが未登録の記事に絞る。
   * 2026-08-26 のサイクル統合で系統別の「未開始」は無くなったため、これ1本になった
   * （旧 `hasUnstartedGa4Evaluation` は廃止。RPC の `p_has_unstarted_ga4_evaluation` は
   *  `default false` のまま渡さない。§10.2 / §18）。
   */
  hasUnstartedGscEvaluation?: boolean;
  /**
   * 「未要約」＝AI要約対象8項目がすべて空 かつ WordPress 連携済みの記事に絞る。
   * 定義は docs/specs/content-annotation-bulk-ai-summary-spec.md BR-02 が正本。
   */
  hasUnsummarized?: boolean;
  /** 未指定・null は更新日の新しい順。GA4 の列は startDate〜endDate で集計した値で並べる */
  sort?: AnalyticsContentSort;
}

export interface AnalyticsContentPage {
  items: AnalyticsContentItem[];
  total: number;
  totalPages: number;
  page: number;
  perPage: number;
  error?: string | undefined;
  ga4Error?: string | undefined;
  ga4Truncated?: boolean;
}
