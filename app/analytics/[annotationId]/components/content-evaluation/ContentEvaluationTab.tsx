'use client';

import type { Ga4ContentEvaluationView, Ga4EvaluationScheduleView } from '@/types/ga4-evaluation';

import { ContentEvaluationCard } from './ContentEvaluationCard';
import { Ga4EvaluationHistoryPanel } from './Ga4EvaluationHistoryPanel';

interface ContentEvaluationTabProps {
  articleTitle?: string | null;
  evaluation: Ga4ContentEvaluationView | null;
  /**
   * 次回評価予定の読み取り専用表示に使う（§10.8「配置」）。
   * 2026-08-26にサイクルをGSC検索順位評価と1本へ統合したため、自前で取得せず
   * GscDashboardClient が既に持っている評価サイクル行から受け取る
   */
  schedule?: Ga4EvaluationScheduleView | null;
  error?: string | null;
}

/**
 * コンテンツ評価の独立タブ。
 *
 * 2026-08-13 合意たたき台は「評価の結果・操作は概要へ統合表示」だったが、
 * 概要の最下部に埋もれて到達性が低かったため独立タブへ切り出した（2026-08-19。
 * D3 / Q-C の見直しにあたるため、クライアント確認まではこの構成を暫定とする）。
 * GSC 側の「検索順位評価」タブとは別領域のまま保つ（仕様書 §10.3 の7番）。
 */
export function ContentEvaluationTab({
  articleTitle = null,
  evaluation,
  schedule = null,
  error = null,
}: ContentEvaluationTabProps) {
  return (
    <div className="space-y-6">
      <ContentEvaluationCard
        articleTitle={articleTitle}
        evaluation={evaluation}
        error={error}
        schedule={schedule}
      />
      <Ga4EvaluationHistoryPanel evaluation={evaluation} />
    </div>
  );
}
