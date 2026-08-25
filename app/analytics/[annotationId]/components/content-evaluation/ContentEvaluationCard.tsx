'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2, Play, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  formatGa4Duration,
  formatGa4ScoreDiff,
  getGa4DataQualityLabel,
  getGa4MissingMetricLabel,
  getGa4DiagnosisLabel,
  getGa4EvaluationStatusLabel,
  getGa4ScoreBand,
} from '@/lib/ga4-evaluation-display';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';

import { resolveCardHistoryItem } from './latest-history';

interface Props {
  /** カード見出しに出す記事タイトル。クライアント提供の記事カード設計（評価エンジン仕様 §08）に合わせる */
  articleTitle?: string | null;
  evaluation: Ga4ContentEvaluationView | null;
  onRun: () => Promise<void>;
  onRetryNarrative?: () => Promise<void>;
  error?: string | null;
  /** コンテンツ評価サイクル設定（読み取り専用表示のみ。設定操作は概要タブ。§10.8「配置」） */
  cycle?: Ga4ContentEvaluationCycleView | null;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ja-JP');
}

/**
 * 点数帯で色を出し分ける。
 *
 * カード内の規則は「色は常にその数字自身の良し悪しを表す」の1本。
 * 大きい数字とピルはコンテンツ力スコア、内訳バーはそれぞれ読み始め／読了スコア、
 * 診断見出しは記事全体の話なのでコンテンツ力スコアで色を決める。
 * バーをコンテンツ力スコアの色で塗ると、悪い数字が良い色をまとって読み手を迷わせる。
 *
 * 段数は評価エンジン仕様 §03 の点数帯に合わせて5段にする。原文が
 * 「2つの指標も、掛け合わせも、すべて同じ点数帯の意味を持たせる。ユーザーが覚える
 * 物差しは1本だけにする」と定めているため、ラベル5段に対して色を4段へ丸めると
 * 目盛りの数が食い違う。深刻と要改善は赤の濃淡で分ける（色相を5つ使うと差が読めない）。
 * 色だけに頼らないよう帯ラベルは必ず併記する。
 *
 * 具体的な色値は原文に指定が無い（HTML は帯を .b1〜.b5 の5クラスで塗り分けているが、
 * その CSS は共有されていない）。ここは開発側の選択で、確定値が共有されたら差し替える。
 */
function getScoreBandTone(score: number | null): { text: string; pill: string; bar: string } {
  if (score === null) return { text: 'text-gray-700', pill: 'bg-gray-100 text-gray-700', bar: 'bg-gray-400' };
  // 0-19 深刻
  if (score < 20) return { text: 'text-rose-800', pill: 'bg-rose-100 text-rose-900', bar: 'bg-rose-700' };
  // 20-39 要改善
  if (score < 40) return { text: 'text-rose-600', pill: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' };
  // 40-59 改善の余地あり
  if (score < 60) return { text: 'text-amber-600', pill: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' };
  // 60-79 合格ライン
  if (score < 80) return { text: 'text-sky-700', pill: 'bg-sky-50 text-sky-800', bar: 'bg-sky-500' };
  // 80-100 良好
  return { text: 'text-emerald-700', pill: 'bg-emerald-50 text-emerald-800', bar: 'bg-emerald-500' };
}

function getMeasuredScrollUsers(dataQuality: unknown): number | null {
  if (typeof dataQuality !== 'object' || dataQuality === null || Array.isArray(dataQuality)) return null;
  const scrollUsers = (dataQuality as { scrollUsers?: unknown }).scrollUsers;
  return typeof scrollUsers === 'number' && Number.isFinite(scrollUsers) ? scrollUsers : null;
}

function getMissingMetricsFromDataQuality(dataQuality: unknown): string[] {
  if (typeof dataQuality !== 'object' || dataQuality === null || Array.isArray(dataQuality)) return [];
  const missingMetrics = (dataQuality as { missingMetrics?: unknown }).missingMetrics;
  return Array.isArray(missingMetrics)
    ? missingMetrics.filter((metric): metric is string => typeof metric === 'string')
    : [];
}

function formatDateJP(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function ContentEvaluationCard({
  articleTitle = null,
  evaluation,
  onRun,
  onRetryNarrative,
  error = null,
  cycle = null,
}: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const latest = resolveCardHistoryItem(evaluation);
  const latestRun = evaluation?.history[0] ?? null;
  const displayStatus = evaluation?.displayStatus ?? 'unassessed';
  const canRun = ['eligible', 'evaluated', 'narrative_failed', 'evaluation_failed'].includes(displayStatus);
  const canShowAction = !['unassessed', 'low_data', 'evaluating', 'needs_reauth', 'import_failed', 'insufficient_data'].includes(displayStatus);
  const dataQualitySource = displayStatus === 'insufficient_data' ? latestRun : latest;
  const missingMetrics = displayStatus === 'unassessed'
    ? evaluation?.missingMetrics ?? []
    : getMissingMetricsFromDataQuality(dataQualitySource?.dataQuality);

  const handleRun = async () => {
    if (!canRun || isRunning) return;
    setIsRunning(true);
    try {
      await (displayStatus === 'narrative_failed' && onRetryNarrative ? onRetryNarrative() : onRun());
    } finally {
      setIsRunning(false);
    }
  };

  const engagedUsers = latest?.sessions !== null && latest?.sessions !== undefined && latest.engageRate !== null
    ? Math.round(latest.engageRate * latest.sessions)
    : null;
  const measuredScrollUsers = latest ? getMeasuredScrollUsers(latest.dataQuality) : null;
  const previous = latest
    ? evaluation?.history.find(item =>
        item.id !== latest.id &&
        (item.status === 'evaluated' || item.status === 'narrative_failed') &&
        item.contentScore !== null && item.engageScore !== null && item.readScore !== null
      ) ?? null
    : null;
  const actionLabel = isRunning
    ? '評価中です'
    : displayStatus === 'eligible'
      ? '評価を実行'
      : displayStatus === 'narrative_failed'
          ? '診断コメントを再作成'
          : latest
            ? '再評価'
            : '評価を実行';
  const scoreDiff = (current: number | null, previousScore: number | null): string =>
    current === null || previousScore === null ? formatGa4ScoreDiff(null) : formatGa4ScoreDiff(current - previousScore);
  const formatPercent = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
  const tone = getScoreBandTone(latest?.contentScore ?? null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{articleTitle || 'コンテンツ評価'}</CardTitle>
        </div>
        {/* 状態バッジと主操作をタイトルと同じ行にまとめる。shrink-0 で、長い記事タイトル（左は
            min-w-0 + truncate）に押されてボタンが潰れないようにする */}
        {(displayStatus !== 'evaluated' || canShowAction) && (
          <div className="flex shrink-0 items-center gap-3">
            {/* 評価済みのときは状態バッジを出さない。カード本体にスコア・点数帯ピル・診断見出しが
                出ており「評価済み」の一言が情報を足さないため。それ以外の状態は状態バッジでしか
                伝わらないので引き続き表示する */}
            {displayStatus !== 'evaluated' && (
              <span className="rounded-full border px-3 py-1 text-sm" aria-live="polite">
                {displayStatus === 'unassessed' ? '未評価（データが不足）' : getGa4EvaluationStatusLabel(displayStatus)}
              </span>
            )}
            {canShowAction && (
              <Button type="button" onClick={handleRun} disabled={isRunning || !canRun}>
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : latest ? <RefreshCw className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                {actionLabel}
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {cycle && (
          <p className="text-xs text-muted-foreground">
            {/* 概要タブの状態カード（ContentEvaluationCycleSettings.tsx）とラベルの意味を揃える。
                ベースライン未完了時は同じ値を「次回の自動評価予定」と呼ぶと語感が食い違うため
                「ベースライン再試行予定」に統一する（再レビュー指摘） */}
            {cycle.lastSeenContentScore != null ? '次回の自動評価予定' : 'ベースライン再試行予定'}：
            {formatDateJP(cycle.nextEvaluationDate)}{' '}
            {cycle.evaluationHour.toString().padStart(2, '0')}:00（日本時間）。設定は概要タブから変更できます。
          </p>
        )}
        {(error || displayStatus === 'evaluation_failed' || displayStatus === 'import_failed') && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error ?? (displayStatus === 'import_failed' ? 'データを再取得してから評価を実行してください。' : '評価に失敗しました。時間をおいて再評価してください。')}</AlertDescription>
          </Alert>
        )}
        {displayStatus === 'needs_reauth' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">Google連携を確認してから評価を実行してください。</p>
            {/* この状態では上の主操作ボタンが出ず、これが唯一の復帰導線になる。
                白地の outline だと押せる要素に見えないため、既定の塗りつぶしにする
                （Ga4DashboardClient.tsx の未連携時「GA4設定に移動」と同じ扱い） */}
            <Button asChild type="button">
              <Link href="/setup/ga4">Googleを再連携</Link>
            </Button>
          </div>
        )}
        {displayStatus === 'import_failed' && (
          <Button asChild type="button">
            <Link href="/setup/ga4">データを再取得</Link>
          </Button>
        )}
        {displayStatus === 'low_data' && <p className="text-sm text-muted-foreground">セッションが30に達すると評価できます。</p>}
        {(displayStatus === 'unassessed' || displayStatus === 'insufficient_data') && (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">不足項目を確認</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {missingMetrics.map(metric => (
                <li key={metric}>{getGa4MissingMetricLabel(metric)}</li>
              ))}
              {missingMetrics.length === 0 && <li>{getGa4DataQualityLabel(dataQualitySource?.dataQuality)}</li>}
            </ul>
          </details>
        )}
        {displayStatus === 'insufficient_data' && <p className="text-sm text-muted-foreground">評価に必要なデータが不足しています。</p>}
        {displayStatus === 'evaluating' && (
          <p className="text-sm text-muted-foreground">
            {(() => {
              const evaluating = evaluation?.history.find(item => item.status === 'evaluating');
              return evaluating && evaluating.attemptCount > 1
                ? `再試行中（${Math.min(evaluating.attemptCount, 3)}/3）`
                : '評価中です。完了まで最大3分かかる場合があります。完了後に再読み込みしてください。';
            })()}
          </p>
        )}

        {latest?.contentScore !== null && latest?.contentScore !== undefined ? (
          <div className="space-y-5">
            {(displayStatus === 'evaluating' || displayStatus === 'evaluation_failed') && (
              <p className="rounded-md border p-3 text-sm font-medium">
                {displayStatus === 'evaluating' ? '前回の評価結果' : '前回の成功結果'}
              </p>
            )}
            {/* PC では数値ブロックと診断文を横に並べる。1カラムのままだと
                カード右側が大きく空き、バーだけが間延びして見える */}
            <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
              <div className="space-y-5">
            {/* 点数：数字を主役にし、点数帯はピルで右に置く（評価エンジン仕様 §08 の記事カード） */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-baseline gap-2">
                <span className={`text-5xl font-bold leading-none tracking-tight ${tone.text}`}>
                  {latest.contentScore}
                </span>
                <span className="text-sm text-muted-foreground">点 ／ コンテンツ力</span>
              </p>
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${tone.pill}`}>
                {getGa4ScoreBand(latest.contentScore)}
              </span>
            </div>

            {/* 内訳スコア：ラベル・数値・バーを1行に並べて大小を一目で比べられるようにする */}
            <div className="space-y-2">
              {([
                { label: '読み始め', value: latest.engageScore },
                { label: '読了', value: latest.readScore },
              ] as const).map(item => (
                <div key={item.label} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-muted-foreground">{item.label}</span>
                  <span className="w-8 shrink-0 text-right font-semibold tabular-nums">{item.value ?? '—'}</span>
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">
                    {getGa4ScoreBand(item.value)}
                  </span>
                  <div
                    className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${item.label}スコア`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    {...(item.value !== null ? { 'aria-valuenow': item.value } : {})}
                  >
                    <div
                      className={`h-full rounded-full ${getScoreBandTone(item.value).bar}`}
                      style={{ width: `${item.value ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>診断：{getGa4DiagnosisLabel(latest.diagnosisCode)}</span>
              <span>サイト内順位 {latest.siteRank ?? '—'}位 / {latest.totalArticles ?? '—'}記事中</span>
            </div>
            {measuredScrollUsers !== null && latest.scrollRate !== null && latest.readScore !== null && latest.scrollRate >= 0.4 && latest.readScore < 40 && (
              <p className="rounded-md bg-muted p-3 text-sm">補助ラベル：流し読み型</p>
            )}
            {/* ファネル：率ではなく実数で語る（評価エンジン仕様 §08）。ラベルは GA4 の生指標名を使う（§10.7） */}
            <div className="border-y py-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <div>
                  <p className="text-2xl font-bold leading-none tabular-nums">{latest.sessions ?? '—'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">セッション</p>
                </div>
                <span aria-hidden="true" className="mt-1 text-muted-foreground">▶</span>
                <div>
                  <p className="text-2xl font-bold leading-none tabular-nums">{engagedUsers ?? '—'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">エンゲージメントのあったセッション数</p>
                </div>
                {measuredScrollUsers !== null && (
                  <>
                    <span aria-hidden="true" className="mt-1 text-muted-foreground">▶</span>
                    <div>
                      <p className="text-2xl font-bold leading-none tabular-nums">{measuredScrollUsers}</p>
                      <p className="mt-1 text-xs text-muted-foreground">最後まで</p>
                    </div>
                  </>
                )}
              </div>
              {/* 読了率から人数を換算しない（率は平均時間の比であり人数比ではない。§08 の禁則） */}
              {measuredScrollUsers === null && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {latest.scrollRate === null
                    ? '最後までの人数と率は実測できないため表示していません。'
                    : `最後まで読んだ人数は実測できていません。1人あたり平均で全体の${formatPercent(latest.scrollRate)}まで読まれています。`}
                </p>
              )}
            </div>
              </div>

              <div>
            {latest.narrative ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className={`text-base font-bold ${tone.text}`}>{latest.narrative.headline}</p>
                  <p className="text-sm leading-relaxed text-gray-700">{latest.narrative.situation}</p>
                  <p className="text-sm leading-relaxed text-gray-700">{latest.narrative.cause}</p>
                </div>
                {/* NEXT ACTION は独立した箱にする。次の一手を探して読み直さなくて済むように */}
                <div className="rounded-md bg-teal-50 p-4">
                  <p className="text-xs font-semibold tracking-widest text-teal-800">NEXT ACTION</p>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-gray-900">
                    {latest.narrative.next_action}
                  </p>
                  <p className="mt-1 text-sm text-teal-900">狙い：{latest.narrative.target}</p>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-muted p-3 text-sm">スコアは保存されています。診断コメントは作成できませんでした。</p>
            )}
              </div>
            </div>

            <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {/* 生値の2つは Google Analytics 4（以下、GA4）の画面と突き合わせる前提の数字なので先頭に置く（§10.3） */}
                <span>平均エンゲージメント時間：{formatGa4Duration(latest.avgEngagementSeconds)}</span>
                <span>エンゲージメント率：{formatPercent(latest.engageRate)}</span>
                <span>評価対象期間：{latest.periodStart ?? '—'} から {latest.periodEnd ?? '—'}</span>
                <span>データ品質：{getGa4DataQualityLabel(latest.dataQuality)}</span>
                {/* 前回が無い評価で「初回計測」を3つ並べても読み手に情報がないため出さない */}
                {previous && (
                  <span className="sm:col-span-2 xl:col-span-4">
                    前回差分：コンテンツ力 {scoreDiff(latest.contentScore, previous.contentScore)} / 読み始め {scoreDiff(latest.engageScore, previous.engageScore)} / 読了 {scoreDiff(latest.readScore, previous.readScore)}
                  </span>
                )}
              </div>
              {/* 版番号と日時は普段は畳む。仕様 §10.3 の6も「評価情報」の詳細欄で確認できればよいとしている */}
              <details>
                <summary className="cursor-pointer">評価情報</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <span>最終評価日時：{formatDate(latest.completedAt)}</span>
                  <span>データ取得日時：{formatDate(latest.ga4DataFetchedAt)}</span>
                  <span>評価設定：v{latest.scoringConfigVersion} / 文章 v{latest.promptVersion ?? '—'}</span>
                </div>
              </details>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">評価結果はまだありません。</p>
        )}
      </CardContent>
    </Card>
  );
}
