import type { GscEvaluationOutcome } from '@/types/gsc';

/**
 * ダッシュボード詳細API のレスポンス型
 */
export interface GscDashboardDetailResponse {
  annotation: {
    id: string;
    wp_post_id: number | null;
    wp_post_title: string | null;
    canonical_url: string | null;
    opening_proposal: string | null;
    wp_content_text: string | null;
    wp_excerpt?: string | null;
    persona: string | null;
    needs: string | null;
  };
  metrics: GscDailyMetric[];
  history: GscEvaluationHistoryItem[];
  evaluation: GscCurrentEvaluation | null;
  next_evaluation_run_utc?: string | null;
  credential: {
    propertyUri: string | null;
  } | null;
}

/**
 * 日別メトリクス（時系列グラフ用）
 */
interface GscDailyMetric {
  date: string;
  position: number | null;
  ctr: number | null;
  clicks: number | null;
  impressions: number | null;
}

/**
 * 評価履歴の1レコード
 */
export interface GscEvaluationHistoryItem {
  id: string;
  evaluation_date: string;
  previous_position: number | null;
  current_position: number | null; // nullable for errors
  outcome: GscEvaluationOutcome | null; // nullable for errors
  outcomeType: 'success' | 'error';
  errorCode?: 'import_failed' | 'no_metrics' | null;
  errorMessage?: string | null;
  suggestion_summary: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * 現在の評価設定
 */
interface GscCurrentEvaluation {
  id: string;
  user_id: string;
  content_annotation_id: string;
  property_uri: string;
  last_evaluated_on: string | null;
  base_evaluation_date: string;
  cycle_days: number;
  evaluation_hour: number;
  last_seen_position: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * メトリクスサマリー（4指標カード用）
 */
export interface GscMetricsSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * グラフ表示制御用
 */
export interface GscVisibleMetrics {
  clicks: boolean;
  impressions: boolean;
  ctr: boolean;
  position: boolean;
}

/**
 * チャートデータ（recharts用に整形済み）
 */
export interface GscChartDataPoint {
  date: string;
  position: number | null;
  ctr: number | null; // パーセンテージ（0-100）
  clicks: number | null;
  impressions: number | null;
}

// ============================================
// Query Analysis Tab 用の型定義
// ============================================

/**
 * クエリ別集計データ（散布図 + テーブル用）
 */
interface GscQueryAggregation {
  query: string;
  queryNormalized: string;
  clicks: number;
  impressions: number;
  ctr: number; // 0-1 の小数
  position: number; // 平均掲載順位
  // 前期間比較
  positionChange?: number | null; // 正: 悪化, 負: 改善
  clicksChange?: number | null;
  // メタ情報
  wordCount: number; // クエリの単語数（ロングテール判定用）
  isBrandQuery?: boolean; // 指名検索フラグ
}

/**
 * クエリ分析タブのフィルタ状態
 */
interface GscQueryFilterState {
  searchText: string;
  sortBy: 'clicks' | 'impressions' | 'ctr' | 'position' | 'positionChange';
  sortOrder: 'asc' | 'desc';
  excludeBrand: boolean;
  minWordCount: number; // ロングテールフィルタ（3以上でロングテール）
  dateRange: '7d' | '28d' | '3m';
}

/**
 * 散布図のデータポイント
 */
interface GscScatterDataPoint {
  query: string;
  position: number; // X軸
  ctr: number; // Y軸（パーセンテージ）
  impressions: number; // バブルサイズ
  clicks: number;
  // 象限判定用
  quadrant: 'winner' | 'title-fix' | 'treasure' | 'low-priority';
}

/**
 * クエリ分析APIレスポンス
 */
interface GscQueryAnalysisResponse {
  queries: GscQueryAggregation[];
  summary: {
    totalQueries: number;
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
  };
  period: {
    start: string;
    end: string;
    comparisonStart?: string;
    comparisonEnd?: string;
  };
}
