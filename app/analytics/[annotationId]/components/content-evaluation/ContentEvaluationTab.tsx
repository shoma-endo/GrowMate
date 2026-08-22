'use client';

import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

import { ContentEvaluationCard } from './ContentEvaluationCard';
import { Ga4EvaluationHistoryPanel } from './Ga4EvaluationHistoryPanel';

interface ContentEvaluationTabProps {
  articleTitle?: string | null;
  evaluation: Ga4ContentEvaluationView | null;
  error?: string | null;
  onRun: () => Promise<void>;
  onRetryNarrative?: () => Promise<void>;
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
  error = null,
  onRun,
  onRetryNarrative,
}: ContentEvaluationTabProps) {
  return (
    <div className="space-y-6">
      <ContentEvaluationCard
        articleTitle={articleTitle}
        evaluation={evaluation}
        error={error}
        onRun={onRun}
        {...(onRetryNarrative ? { onRetryNarrative } : {})}
      />
      <Ga4EvaluationHistoryPanel evaluation={evaluation} />
    </div>
  );
}
