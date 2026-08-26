'use client';

import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/date-utils';
import {
  formatGa4Duration,
  formatGa4ScoreDiff,
  getGa4DataQualityLabel,
  getGa4MissingMetricLabel,
  getGa4DiagnosisLabel,
  getGa4EvaluationStatusLabel,
  getGa4ScoreBand,
  getGa4ScoreBandTone,
} from '@/lib/ga4-evaluation-display';
import { addDaysISO } from '@/lib/date-utils';
import type { Ga4ContentEvaluationView, Ga4EvaluationScheduleView } from '@/types/ga4-evaluation';

import { findPreviousScoredItem } from './ga4-evaluation-history-view';
import { resolveCardHistoryItem } from './latest-history';

interface Props {
  /** カード見出しに出す記事タイトル。クライアント提供の記事カード設計（評価エンジン仕様 §08）に合わせる */
  articleTitle?: string | null;
  evaluation: Ga4ContentEvaluationView | null;
  error?: string | null;
  /** 次回評価予定の読み取り専用表示のみ（設定操作は概要タブの検索順位評価サイクル設定カード。§10.8「配置」） */
  schedule?: Ga4EvaluationScheduleView | null;
}

/**
 * 評価情報のタイムスタンプ。未取得は '—'（`formatDateTime` の '日付不明' は
 * 「値はあるが壊れている」の意味なので、値が無い場合に流用しない）。
 */
function formatTimestamp(value: string | null): string {
  return value ? formatDateTime(value) : '—';
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
  error = null,
  schedule = null,
}: Props) {
  const latest = resolveCardHistoryItem(evaluation);
  const latestRun = evaluation?.history[0] ?? null;
  const displayStatus = evaluation?.displayStatus ?? 'unassessed';
  const dataQualitySource = displayStatus === 'insufficient_data' ? latestRun : latest;
  const missingMetrics = displayStatus === 'unassessed'
    ? evaluation?.missingMetrics ?? []
    : getMissingMetricsFromDataQuality(dataQualitySource?.dataQuality);

  const engagedUsers = latest?.sessions !== null && latest?.sessions !== undefined && latest.engageRate !== null
    ? Math.round(latest.engageRate * latest.sessions)
    : null;
  const measuredScrollUsers = latest ? getMeasuredScrollUsers(latest.dataQuality) : null;
  // 「前回」は履歴の並び（startedAt 降順）で latest より後ろ＝より古い行から探す。
  // 評価履歴パネルの「前回 N → M 点」と同じ関数を使い、同じ画面で違う前回を出さない。
  const previous =
    latest && evaluation
      ? findPreviousScoredItem(
          evaluation.history,
          evaluation.history.findIndex(item => item.id === latest.id)
        )
      : null;
  const scoreDiff = (current: number | null, previousScore: number | null): string =>
    current === null || previousScore === null ? formatGa4ScoreDiff(null) : formatGa4ScoreDiff(current - previousScore);
  const formatPercent = (value: number | null): string =>
    value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
  const tone = getGa4ScoreBandTone(latest?.contentScore ?? null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate text-lg">{articleTitle || 'コンテンツ評価'}</CardTitle>
        </div>
        {/* 状態バッジのみ。shrink-0 で、長い記事タイトル（左は min-w-0 + truncate）に
            押されて潰れないようにする。評価の実行は概要タブの「検索順位評価サイクル設定」
            カードへ移動した（同じ操作を2箇所に置かない。§10.8） */}
        {displayStatus !== 'evaluated' && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="rounded-full border px-3 py-1 text-sm" aria-live="polite">
              {displayStatus === 'unassessed' ? '未評価（データが不足）' : getGa4EvaluationStatusLabel(displayStatus)}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* GA4評価ビューが取れているときだけ出す（2026-08-26 レビュー指摘）。
            GA4未連携だと fetchGa4ContentEvaluation が失敗して evaluation が null になり、
            この記事は定期バッチのdue抽出（GA4連携済みユーザーのみ）にも入らない。
            そこへGSCの評価サイクル行を根拠に「次回評価予定」を出すと、来ない予定を約束してしまう */}
        {schedule && evaluation && (
          <p className="text-xs text-muted-foreground">
            {/* 概要タブの検索順位評価サイクル設定カードとラベルの表記を揃える。
                ベースライン計測が済んでいれば「次回評価予定」、未計測なら「初回計測予定」
                （未計測の回は軽量パスでスコアだけを記録し、本評価はその1サイクル後。§6.6.2） */}
            {schedule.ga4LastSeenContentScore != null ? '次回評価予定' : '初回計測予定'}：
            {formatDateJP(
              addDaysISO(schedule.ga4LastEvaluatedOn ?? schedule.baseEvaluationDate, schedule.cycleDays)
            )}{' '}
            {schedule.evaluationHour.toString().padStart(2, '0')}:00（日本時間）。設定は概要タブから変更できます。
          </p>
        )}
        {(error || displayStatus === 'evaluation_failed' || displayStatus === 'import_failed') && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error ?? (displayStatus === 'import_failed' ? 'データを再取得してから、概要タブの「検索順位評価サイクル設定」から評価を実行してください。' : '評価に失敗しました。時間をおいて、概要タブの「検索順位評価サイクル設定」から再評価してください。')}</AlertDescription>
          </Alert>
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
                : '評価中です。完了後に再読み込みしてください。';
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
                      className={`h-full rounded-full ${getGa4ScoreBandTone(item.value).bar}`}
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
                {/* 次の一手は独立した箱にする。探して読み直さなくて済むように。
                    通知メール（ga4-content-evaluation-email.ts）と同じ「次の一手」の語で統一する
                    （旧「NEXT ACTION」は growmate-ui-ux の「英語ラベルはユーザー向けに使わない」に抵触） */}
                <div className="rounded-md bg-teal-50 p-4">
                  <p className="text-xs font-semibold tracking-widest text-teal-800">次の一手</p>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-gray-900">
                    {latest.narrative.next_action}
                  </p>
                  <p className="mt-1 text-sm text-teal-900">狙い：{latest.narrative.target}</p>
                </div>
              </div>
            ) : (
              <p className="rounded-md bg-muted p-3 text-sm">診断コメントを作成できませんでした。スコアは算出済みです。</p>
            )}
              </div>
            </div>

            <div className="space-y-2 border-t pt-4 text-xs text-muted-foreground">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {/* 生値の2つは Google Analytics 4（以下、GA4）の画面と突き合わせる前提の数字なので先頭に置く（§10.3） */}
                <span>平均エンゲージメント時間：{formatGa4Duration(latest.avgEngagementSeconds)}</span>
                <span>エンゲージメント率：{formatPercent(latest.engageRate)}</span>
                <span>評価対象期間：{latest.periodStart ?? '—'} 〜 {latest.periodEnd ?? '—'}</span>
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
                  <span>最終評価日時：{formatTimestamp(latest.completedAt)}</span>
                  <span>データ取得日時：{formatTimestamp(latest.ga4DataFetchedAt)}</span>
                </div>
              </details>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">評価結果はまだありません。概要タブの「検索順位評価サイクル設定」から評価を実行してください。</p>
        )}
      </CardContent>
    </Card>
  );
}
