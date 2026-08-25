'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Search, History, Bell, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGscDashboard } from './hooks/useGscDashboard';
import { OverviewTab } from './components/OverviewTab';
import { EvaluationHistoryTab } from './components/EvaluationHistoryTab';
import { ContentEvaluationTab } from './components/content-evaluation/ContentEvaluationTab';
import type { GscDashboardDetailResponse } from './types';
import type { QueryAnalysisTabProps } from './components/QueryAnalysisTab';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';
import {
  fetchGa4ContentEvaluation,
  retryGa4ContentEvaluationNarrative,
  runGa4ContentEvaluation,
} from '@/server/actions/ga4ContentEvaluation.actions';
import { getGa4EvaluationDateRange } from '@/lib/ga4-evaluation-period';
import { getGa4EvaluationStatusLabel } from '@/lib/ga4-evaluation-display';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';

const GA4_EVALUATION_PROGRESS_POLL_INTERVAL_MS = 500;

const QueryAnalysisTab = dynamic<QueryAnalysisTabProps>(
  () => import('./components/QueryAnalysisTab').then(mod => mod.QueryAnalysisTab),
  { ssr: false }
);

interface Props {
  initialSelectedId?: string | null;
  initialDetail?: GscDashboardDetailResponse | null;
  initialGa4Evaluation?: Ga4ContentEvaluationView | null | undefined;
}

export default function GscDashboardClient({
  initialSelectedId = null,
  initialDetail = null,
  initialGa4Evaluation = null,
}: Props) {
  const dashboard = useGscDashboard({ initialSelectedId, initialDetail });
  const [readHistoryIds, setReadHistoryIds] = useState<Set<string>>(new Set());
  const [ga4Evaluation, setGa4Evaluation] = useState<Ga4ContentEvaluationView | null>(initialGa4Evaluation);
  const [ga4EvaluationError, setGa4EvaluationError] = useState<string | null>(null);

  const runGa4EvaluationWithProgress = async (
    annotationId: string,
    operation: () => Promise<ServerActionResult<Ga4ContentEvaluationView>>
  ): Promise<ServerActionResult<Ga4ContentEvaluationView>> => {
    let completed = false;
    const progressPoll = (async () => {
      while (!completed) {
        await new Promise(resolve => setTimeout(resolve, GA4_EVALUATION_PROGRESS_POLL_INTERVAL_MS));
        if (completed) return;
        const progress = await fetchGa4ContentEvaluation(annotationId);
        if (progress.success && progress.data) {
          setGa4Evaluation(progress.data);
        }
      }
    })();

    try {
      return await operation();
    } finally {
      completed = true;
      await progressPoll;
    }
  };

  // GSC の handleRunEvaluation（EvaluationSettings.tsx）と同じく、実行結果を toast で必ず知らせる
  // （2026-08-25 追加。以前は失敗時のみ ga4EvaluationError の小さな赤文字表示に留まり、成功時は
  // 無音だった。GA4は1記事単位の評価のためGSCのようなバッチ集計サマリーは無く、代わりに
  // displayStatus と直近履歴のスコアで文言を出し分ける）
  const notifyGa4EvaluationResult = (result: ServerActionResult<Ga4ContentEvaluationView>) => {
    if (!result.success || !result.data) {
      toast.error(result.error ?? ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED);
      return;
    }
    const latest = result.data.history[0] ?? null;
    switch (result.data.displayStatus) {
      case 'evaluated':
        toast.success(
          latest?.contentScore != null
            ? `評価が完了しました（コンテンツ力スコア: ${latest.contentScore}点）`
            : '評価が完了しました'
        );
        return;
      case 'narrative_failed':
        toast.warning('スコアの算出は完了しましたが、診断コメントの作成に失敗しました');
        return;
      default:
        toast.error(getGa4EvaluationStatusLabel(result.data.displayStatus));
    }
  };

  const handleRunGa4Evaluation = async () => {
    const annotationId = dashboard.selectedId;
    if (!annotationId) return;
    const { startDate, endDate } = getGa4EvaluationDateRange();
    setGa4EvaluationError(null);
    const result = await runGa4EvaluationWithProgress(annotationId, () => runGa4ContentEvaluation({
      annotationId,
      startDate,
      endDate,
    }));
    notifyGa4EvaluationResult(result);
    if (!result.success || !result.data) {
      setGa4EvaluationError(result.error ?? ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED);
      return;
    }
    setGa4Evaluation(result.data);
  };

  const handleRetryGa4Narrative = async () => {
    const annotationId = dashboard.selectedId;
    if (!annotationId) return;
    setGa4EvaluationError(null);
    const result = await runGa4EvaluationWithProgress(annotationId, () => retryGa4ContentEvaluationNarrative(annotationId));
    notifyGa4EvaluationResult(result);
    if (!result.success || !result.data) {
      setGa4EvaluationError(result.error ?? ERROR_MESSAGES.GA4.EVALUATION_RUN_FAILED);
      return;
    }
    setGa4Evaluation(result.data);
  };

  // 未読の改善提案があるか判定（improved以外で outcome_type が error でないもの）
  const hasUnreadSuggestions = useMemo(() => {
    if (!dashboard.detail?.history) return false;
    return dashboard.detail.history.some(
      item =>
        !item.is_read &&
        item.outcomeType !== 'error' &&
        item.outcome !== 'improved' &&
        !readHistoryIds.has(item.id)
    );
  }, [dashboard.detail?.history, readHistoryIds]);

  const handleHistoryRead = (id: string) => {
    setReadHistoryIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gsc-unread-updated', { detail: { delta: -1 } }));
    }
  };

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* ヘッダー */}
      <div className="space-y-4">
        <Link
          href="/analytics"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          コンテンツ一覧に戻る
        </Link>
        <h1 className="text-3xl font-bold">検索順位・コンテンツ評価</h1>
      </div>

      {/* エラー表示 */}
      {dashboard.error && (
        <Alert variant="destructive">
          <AlertDescription>{dashboard.error}</AlertDescription>
        </Alert>
      )}

      {/* タブ */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">概要</span>
          </TabsTrigger>
          <TabsTrigger value="queries" className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">検索クエリ</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            {hasUnreadSuggestions ? (
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-amber-100 text-amber-600 animate-pulse">
                <Bell className="h-5 w-5" />
              </span>
            ) : (
              <History className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">検索順位評価</span>
          </TabsTrigger>
          <TabsTrigger value="content-evaluation" className="flex items-center gap-2">
            <Gauge className="w-4 h-4" />
            <span className="hidden sm:inline">コンテンツ評価</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab
            detail={dashboard.detail}
            detailLoading={dashboard.detailLoading}
            chartData={dashboard.chartData}
            metricsSummary={dashboard.metricsSummary}
            visibleMetrics={dashboard.visibleMetrics}
            onToggleMetric={dashboard.toggleMetric}
            onRegisterEvaluation={dashboard.handleRegisterEvaluation}
            onUpdateEvaluation={dashboard.handleUpdateEvaluation}
            onRunEvaluation={dashboard.handleRunEvaluation}
            ga4Evaluation={ga4Evaluation}
            ga4EvaluationError={ga4EvaluationError}
            onRunGa4Evaluation={handleRunGa4Evaluation}
            onRetryGa4Narrative={handleRetryGa4Narrative}
            onRunQueryImport={dashboard.handleRunQueryImport}
            onRefreshDetail={async (annotationId: string) => {
              await dashboard.refreshDetail(annotationId);
            }}
          />
        </TabsContent>

        <TabsContent value="content-evaluation" className="mt-6">
          <ContentEvaluationTab
            annotationId={dashboard.selectedId}
            articleTitle={dashboard.detail?.annotation.wp_post_title ?? null}
            evaluation={ga4Evaluation}
            error={ga4EvaluationError}
          />
        </TabsContent>

        <TabsContent value="queries" className="mt-6">
          <QueryAnalysisTab annotationId={dashboard.selectedId} />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <EvaluationHistoryTab history={dashboard.detail?.history} onHistoryRead={handleHistoryRead} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
