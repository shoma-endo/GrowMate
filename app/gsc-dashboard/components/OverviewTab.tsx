'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getQueryImportToastMessage } from '@/lib/gsc-import';
import { cn } from '@/lib/utils';
import { useLiffContext } from '@/components/LiffProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { EvaluationSettings } from '../EvaluationSettings';
import { MetricsSummaryCards } from './MetricsSummaryCards';
import { TrendLineChart } from './TrendLineChart';
import { SuggestionDataReadiness } from './SuggestionDataReadiness';
import type {
  GscDashboardDetailResponse,
  GscMetricsSummary,
  GscVisibleMetrics,
  GscChartDataPoint,
} from '../types';
import type { EvaluationResultSummary } from '@/types/gsc';

interface OverviewTabProps {
  detail: GscDashboardDetailResponse | null;
  detailLoading: boolean;
  chartData: GscChartDataPoint[];
  metricsSummary: GscMetricsSummary | null;
  visibleMetrics: GscVisibleMetrics;
  onToggleMetric: (key: keyof GscVisibleMetrics) => void;
  onRegisterEvaluation: (
    dateStr: string,
    cycleDays: number,
    evaluationHour: number
  ) => Promise<void>;
  onUpdateEvaluation: (dateStr: string, cycleDays: number, evaluationHour: number) => Promise<void>;
  onRunEvaluation: () => Promise<EvaluationResultSummary>;
  onRunQueryImport: () => Promise<{
    querySummary: {
      fetchedRows: number;
      keptRows: number;
      dedupedRows: number;
      fetchErrorPages: number;
      skipped: {
        missingKeys: number;
        invalidUrl: number;
        emptyQuery: number;
        zeroMetrics: number;
      };
      hitLimit: boolean;
    };
  }>;
  onRefreshDetail?: (annotationId: string) => Promise<void>;
}

export function OverviewTab({
  detail,
  detailLoading,
  chartData,
  metricsSummary,
  visibleMetrics,
  onToggleMetric,
  onRegisterEvaluation,
  onUpdateEvaluation,
  onRunEvaluation,
  onRunQueryImport,
  onRefreshDetail,
}: OverviewTabProps) {
  const { isOwnerViewMode } = useLiffContext();
  const [isQueryImporting, setIsQueryImporting] = useState(false);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const isReadOnly = isOwnerViewMode;

  if (detailLoading) {
    return (
      <Card>
        <CardContent className="py-10">
          <div className="flex items-center gap-2 text-gray-500 justify-center">
            <Loader2 className="w-6 h-6 animate-spin" /> 読み込み中...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-gray-500">
          <p>URLパラメータから記事を選択してください</p>
        </CardContent>
      </Card>
    );
  }

  const handleSync = async () => {
    if (isReadOnly) return;
    if (!detail.annotation.canonical_url) {
      toast.error('記事URLが未登録です');
      return;
    }
    setIsSyncDialogOpen(false);
    setIsQueryImporting(true);
    const toastId = toast.loading('クエリ指標を取得中...');
    try {
    const { querySummary } = await onRunQueryImport();
    const toastMessage = getQueryImportToastMessage(querySummary);
      if (toastMessage.type === 'warning') {
        toast.warning(toastMessage.message, { id: toastId });
      } else {
        toast.success(toastMessage.message, { id: toastId });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取得に失敗しました', {
        id: toastId,
      });
    } finally {
      setIsQueryImporting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {/* 記事情報 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">タイトル</p>
            <p className="font-semibold text-lg">{detail.annotation.wp_post_title || '—'}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-gray-500">URL</p>
              <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-blue-200 text-blue-600 hover:text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                    disabled={isQueryImporting || !detail.annotation.canonical_url || isReadOnly}
                  >
                    <RefreshCw
                      className={cn('w-3.5 h-3.5 mr-1.5', isQueryImporting && 'animate-spin')}
                    />
                    最新化
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>クエリ指標の同期</DialogTitle>
                    <DialogDescription>
                      Google Search Console
                      から最新のパフォーマンスデータを取得し、統計情報を更新します。
                      この操作により、現在の指標データは最新の内容で上書きされます。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">キャンセル</Button>
                    </DialogClose>
                    <Button onClick={handleSync} disabled={isQueryImporting || isReadOnly}>
                      {isQueryImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      同期を実行
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <p className="text-sm text-blue-700 break-all bg-blue-50/50 p-2 rounded">
              {detail.annotation.canonical_url || '—'}
            </p>
          </div>
        </div>

        {/* メトリクスカード */}
        {metricsSummary && (
          <MetricsSummaryCards
            summary={metricsSummary}
            visibleMetrics={visibleMetrics}
            onToggle={onToggleMetric}
          />
        )}

        {/* 時系列グラフ */}
        <TrendLineChart data={chartData} visibleMetrics={visibleMetrics} />

        {/* データ準備状況 */}
        <SuggestionDataReadiness
          annotation={detail.annotation}
          {...(onRefreshDetail && { onUpdate: onRefreshDetail })}
        />

        {/* 評価設定 */}
        {detail.credential?.propertyUri && (
          <EvaluationSettings
            currentEvaluation={detail.evaluation}
            onRegister={onRegisterEvaluation}
            onUpdate={onUpdateEvaluation}
            onRunEvaluation={onRunEvaluation}
          />
        )}
      </CardContent>
    </Card>
  );
}
