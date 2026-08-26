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

export interface AnalyticsContentQuery {
  page: number;
  perPage: number;
  startDate: string;
  endDate: string;
  selectedCategoryNames?: string[];
  includeUncategorized?: boolean;
  hasUnreadSuggestion?: boolean;
  /**
   * 「評価未開始」＝評価サイクルが未登録の記事に絞る。
   * 2026-08-26 のサイクル統合で系統別の「未開始」は無くなったため、これ1本になった
   * （旧 `hasUnstartedGa4Evaluation` は廃止。RPC の `p_has_unstarted_ga4_evaluation` は
   *  `default false` のまま渡さない。§10.2 / §18）。
   */
  hasUnstartedGscEvaluation?: boolean;
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
