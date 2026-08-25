'use client';

import { useState } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/date-utils';
import {
  formatGa4Duration,
  getGa4DataQualityLabel,
  getGa4DiagnosisLabel,
  getGa4EvaluationErrorLabel,
  getGa4ScoreBand,
  getGa4ScoreBandTone,
} from '@/lib/ga4-evaluation-display';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

import { findPreviousScoredItem, getGa4EvaluationHistoryState } from './ga4-evaluation-history-view';

/**
 * コンテンツ評価履歴。
 *
 * 検索順位評価履歴（`../EvaluationHistoryTab.tsx`）と同じ読み方に揃える:
 * 一覧は1行のサマリー（日時・状態・判定・スコアの遷移）だけを出し、詳細はクリックで
 * 単一のダイアログに開く（仕様書 §10.3 末尾「履歴詳細は…単一のダイアログで表示する。
 * ダイアログ上に別のダイアログを重ねない」）。同じ画面に並ぶ2つの履歴の操作感を揃えるのが目的。
 *
 * GSC 側と意図的に揃えていない点は2つ:
 * - 未読ドット・「既読にする」ボタンを持たない。GSC の既読は AI 改善提案の通知に紐づく
 *   機能で、コンテンツ評価には対応する状態が無い。
 * - 履歴0件のときは空状態カードを出さず、パネルごと描かない。GSC は履歴タブ単体なので
 *   専用の空状態が要るが、こちらは直上の記事カードが同じ内容の案内を既に出している。
 */
export function Ga4EvaluationHistoryPanel({ evaluation }: { evaluation: Ga4ContentEvaluationView | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const history = evaluation?.history ?? [];
  // id で引き直す。評価実行中のポーリングで履歴が入れ替わっても、
  // 消えた行を選んだままにならない（GSC が useEffect でやっているのと同じ効果）。
  const selectedIndex = selectedId ? history.findIndex(item => item.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? history[selectedIndex] : null;

  if (history.length === 0) return null;

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">コンテンツ評価履歴</CardTitle>
          <p className="text-sm text-muted-foreground">行を選ぶと、その回の詳細を表示します。</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {history.map((item, index) => {
              const viewState = getGa4EvaluationHistoryState(item);
              const previous = findPreviousScoredItem(history, index);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`group flex w-full cursor-pointer items-center justify-between rounded-lg border p-4 text-left shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
                    viewState.isError
                      ? 'border-red-200 bg-red-50 hover:bg-red-100'
                      : 'bg-card hover:bg-accent'
                  }`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="flex items-center gap-3">
                    {viewState.isError && <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />}
                    <div>
                      <p className="text-sm font-medium">{formatDateTime(item.startedAt)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">{viewState.leadLabel}</span>
                        <span className={viewState.badgeClassName}>{viewState.badgeLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {viewState.showScoreTransition && (
                      <div className="flex items-baseline justify-end gap-2">
                        <span className="text-xs text-muted-foreground">
                          前回: {previous?.contentScore ?? '—'}
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground">
                          →
                        </span>
                        <span className="text-lg font-bold tabular-nums">
                          {item.contentScore ?? '—'}
                        </span>
                        {item.contentScore !== null && (
                          <span className="text-xs text-muted-foreground">点</span>
                        )}
                      </div>
                    )}
                    <ChevronRight
                      className={`h-5 w-5 shrink-0 transition-all duration-200 group-hover:translate-x-1 ${
                        viewState.isError
                          ? 'text-red-400 group-hover:text-red-600'
                          : 'text-muted-foreground group-hover:text-primary'
                      }`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={open => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>コンテンツ評価の詳細</DialogTitle>
          </DialogHeader>
          {selected && (
            <Ga4EvaluationHistoryDetail
              item={selected}
              previous={findPreviousScoredItem(history, selectedIndex)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Ga4EvaluationHistoryItem = Ga4ContentEvaluationView['history'][number];

function Ga4EvaluationHistoryDetail({
  item,
  previous,
}: {
  item: Ga4EvaluationHistoryItem;
  previous: Ga4EvaluationHistoryItem | null;
}) {
  const viewState = getGa4EvaluationHistoryState(item);
  const tone = getGa4ScoreBandTone(item.contentScore);

  return (
    <div className="space-y-4">
      {viewState.showScoreTransition ? (
        // 検索順位評価履歴のダイアログと同じ4枠（評価日／判定／前回／今回）。
        // 順位がスコアに変わるだけで、読ませる順番と組版は同じにする
        <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted p-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">実行日時</p>
            <p className="text-sm font-medium">{formatDateTime(item.startedAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">判定</p>
            <span className={viewState.badgeClassName}>{getGa4DiagnosisLabel(item.diagnosisCode)}</span>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">前回のコンテンツ力</p>
            <p className="text-sm font-medium">
              {previous?.contentScore ?? '—'}
              {previous?.contentScore != null && '点'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">コンテンツ力</p>
            <p className={`text-sm font-medium ${tone.text}`}>
              {item.contentScore ?? '—'}
              {item.contentScore !== null && `点 ／ ${getGa4ScoreBand(item.contentScore)}`}
            </p>
          </div>
        </div>
      ) : (
        <Alert variant={viewState.isError ? 'destructive' : 'default'}>
          {viewState.isError && <AlertCircle className="h-4 w-4" />}
          <AlertTitle>{viewState.statusLabel}</AlertTitle>
          <AlertDescription>
            {viewState.isError && <span>{getGa4EvaluationErrorLabel(item.errorCode)}</span>}
            {viewState.isNoData && <span>{getGa4DataQualityLabel(item.dataQuality)}</span>}
            {viewState.isRunning && (
              <span>
                {item.attemptCount > 1
                  ? `再試行中（${Math.min(item.attemptCount, 3)}/3）`
                  : '完了後に再読み込みしてください。'}
              </span>
            )}
            <span className="block">実行日時: {formatDateTime(item.startedAt)}</span>
          </AlertDescription>
        </Alert>
      )}

      {viewState.showScoreTransition && (
        <div>
          <p className="mb-2 text-sm font-semibold">診断コメント</p>
          {item.narrative ? (
            // 記事カードと同じ組版にする。同じ内容が場所によって違う形で出ると読み直しが要る
            <div className="space-y-4">
              <div className="space-y-2">
                <p className={`text-base font-bold ${tone.text}`}>{item.narrative.headline}</p>
                <p className="text-sm leading-relaxed text-gray-700">{item.narrative.situation}</p>
                <p className="text-sm leading-relaxed text-gray-700">{item.narrative.cause}</p>
              </div>
              <div className="rounded-md bg-teal-50 p-4">
                <p className="text-xs font-semibold tracking-widest text-teal-800">次の一手</p>
                <p className="mt-2 text-sm font-medium leading-relaxed text-gray-900">
                  {item.narrative.next_action}
                </p>
                <p className="mt-1 text-sm text-teal-900">狙い：{item.narrative.target}</p>
              </div>
            </div>
          ) : (
            // status が evaluated でも、保存済み JSON の検証に失敗すると narrative は null になる。
            // status ではなく narrative の有無で分岐する
            <p className="rounded-md bg-muted p-3 text-sm">
              診断コメントを作成できませんでした。スコアは算出済みです。
            </p>
          )}
        </div>
      )}

      <div className="grid gap-2 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-2">
        <span>状態：{viewState.statusLabel}</span>
        <span>読み始めスコア：{item.engageScore ?? '—'}</span>
        <span>読了スコア：{item.readScore ?? '—'}</span>
        <span>
          サイト内順位：{item.siteRank ?? '—'}位 / {item.totalArticles ?? '—'}記事中
        </span>
        {/* 期間は 'YYYY-MM-DD' の日付であって時刻ではないため、日時整形に通さない */}
        <span>
          評価対象期間：{item.periodStart ?? '—'} 〜 {item.periodEnd ?? '—'}
        </span>
        <span>平均エンゲージメント時間：{formatGa4Duration(item.avgEngagementSeconds)}</span>
        <span>データ品質：{getGa4DataQualityLabel(item.dataQuality)}</span>
      </div>
    </div>
  );
}
