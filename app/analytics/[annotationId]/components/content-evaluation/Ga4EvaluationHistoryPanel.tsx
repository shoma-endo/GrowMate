'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatGa4Duration,
  getGa4DataQualityLabel,
  getGa4DiagnosisLabel,
  getGa4EvaluationErrorLabel,
  getGa4EvaluationStatusLabel,
  getGa4ScoreBand,
} from '@/lib/ga4-evaluation-display';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

import { resolveCardHistoryItem } from './latest-history';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ja-JP');
}

export function Ga4EvaluationHistoryPanel({ evaluation }: { evaluation: Ga4ContentEvaluationView | null }) {
  // 記事カードが本文として出している1件は除く。10項目中9項目が同じ値で、
  // 評価が1回しかない状態だと同じ内容を2度読ませることになる
  const cardItemId = resolveCardHistoryItem(evaluation)?.id ?? null;
  const pastItems = (evaluation?.history ?? []).filter(item => item.id !== cardItemId);
  if (!evaluation || pastItems.length === 0) return null;
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-lg">コンテンツ評価履歴</CardTitle>
        <p className="text-sm text-muted-foreground">最新の評価結果はこのページの上部に表示しています。</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {pastItems.map(item => (
          <div key={item.id} className="space-y-2 rounded-md border p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <span>実行日時：{formatDate(item.startedAt)}</span>
              <span>状態：{getGa4EvaluationStatusLabel(item.status)}</span>
              <span>コンテンツ力：{item.contentScore === null ? '—' : `${item.contentScore}点 ／ ${getGa4ScoreBand(item.contentScore)}`}</span>
              <span>診断：{getGa4DiagnosisLabel(item.diagnosisCode)}</span>
              <span>読み始めスコア：{item.engageScore ?? '—'}</span>
              <span>読了スコア：{item.readScore ?? '—'}</span>
              <span>対象期間：{item.periodStart ?? '—'} 〜 {item.periodEnd ?? '—'}</span>
              <span>平均エンゲージメント時間：{formatGa4Duration(item.avgEngagementSeconds)}</span>
              <span>データ品質：{getGa4DataQualityLabel(item.dataQuality)}</span>
            </div>
            {item.narrative && <p>診断文：{item.narrative.situation}</p>}
            {item.errorCode && <p className="text-red-700">失敗理由：{getGa4EvaluationErrorLabel(item.errorCode)}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
