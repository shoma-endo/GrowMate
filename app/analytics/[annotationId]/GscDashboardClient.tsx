'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Search, History, Bell } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGscDashboard } from './hooks/useGscDashboard';
import { OverviewTab } from './components/OverviewTab';
import { EvaluationHistoryTab } from './components/EvaluationHistoryTab';
import type { GscDashboardDetailResponse } from './types';
import type { QueryAnalysisTabProps } from './components/QueryAnalysisTab';

const QueryAnalysisTab = dynamic<QueryAnalysisTabProps>(
  () => import('./components/QueryAnalysisTab').then(mod => mod.QueryAnalysisTab),
  { ssr: false }
);

interface Props {
  initialSelectedId?: string | null;
  initialDetail?: GscDashboardDetailResponse | null;
}

export default function GscDashboardClient({
  initialSelectedId = null,
  initialDetail = null,
}: Props) {
  const dashboard = useGscDashboard({ initialSelectedId, initialDetail });
  const [readHistoryIds, setReadHistoryIds] = useState<Set<string>>(new Set());

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
        <h1 className="text-3xl font-bold">Google Search Console ダッシュボード</h1>
      </div>

      {/* エラー表示 */}
      {dashboard.error && (
        <Alert variant="destructive">
          <AlertDescription>{dashboard.error}</AlertDescription>
        </Alert>
      )}

      {/* タブ */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">概要</span>
          </TabsTrigger>
          <TabsTrigger value="queries" className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">検索クエリ分析</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            {hasUnreadSuggestions ? (
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-amber-100 text-amber-600 animate-pulse">
                <Bell className="h-5 w-5" />
              </span>
            ) : (
              <History className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">評価履歴</span>
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
            onRunQueryImport={dashboard.handleRunQueryImport}
            onRefreshDetail={async (annotationId: string) => {
              await dashboard.refreshDetail(annotationId);
            }}
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
