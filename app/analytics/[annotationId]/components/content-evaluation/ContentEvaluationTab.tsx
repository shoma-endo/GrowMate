'use client';

import { useEffect, useState } from 'react';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';
import { fetchGa4ContentEvaluationCycle } from '@/server/actions/ga4ContentEvaluationCycle.actions';

import { ContentEvaluationCard } from './ContentEvaluationCard';
import { Ga4EvaluationHistoryPanel } from './Ga4EvaluationHistoryPanel';

interface ContentEvaluationTabProps {
  /** サイクル設定の読み取り専用表示に使う（§10.8「配置」）。QueryAnalysisTab と同じ自己取得パターン */
  annotationId: string | null;
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
  annotationId,
  articleTitle = null,
  evaluation,
  error = null,
  onRun,
  onRetryNarrative,
}: ContentEvaluationTabProps) {
  const [cycle, setCycle] = useState<Ga4ContentEvaluationCycleView | null>(null);

  useEffect(() => {
    if (!annotationId) {
      setCycle(null);
      return;
    }
    let cancelled = false;
    fetchGa4ContentEvaluationCycle(annotationId).then(result => {
      if (cancelled) return;
      setCycle(result.success ? (result.data ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [annotationId]);

  return (
    <div className="space-y-6">
      <ContentEvaluationCard
        articleTitle={articleTitle}
        evaluation={evaluation}
        error={error}
        onRun={onRun}
        cycle={cycle}
        {...(onRetryNarrative ? { onRetryNarrative } : {})}
      />
      <Ga4EvaluationHistoryPanel evaluation={evaluation} />
    </div>
  );
}
