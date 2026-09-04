'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AnalyticsTable from '@/components/AnalyticsTable';
import InstagramTab from './components/InstagramTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Download,
  Settings,
  BarChart3,
  Loader2,
  TrendingUp,
  FileText,
  ImageIcon,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorAlert } from '@/components/ErrorAlert';
import { toast } from 'sonner';
import { registerEvaluationsBulk } from '@/server/actions/gscDashboard.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { AnalyticsContentItem } from '@/types/analytics';
import type {
  InstagramMediaListItem,
  InstagramMediaSortKey,
  InstagramMediaTypeFilter,
} from '@/types/instagram';
import { useRouter } from 'next/navigation';
import { buildListingSelectionKey } from './selection-scope';
import { summarizeContentAnnotationsBulk } from '@/server/actions/contentAnnotationBulkSummary.actions';
import { resolveRawSelectedCount, toggleIdMembership } from '@/lib/analytics-selection';
import {
  buildIgFilterHref,
  buildIgPageHref,
  buildInstagramHref,
  type AnalyticsHrefState,
} from './build-href';

interface AnalyticsClientProps {
  items: AnalyticsContentItem[];
  allCategoryNames: string[];
  unreadAnnotationIds: string[];
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  hasUnstartedGscEvaluation: boolean;
  hasUnsummarized: boolean;
  ga4Truncated: boolean;
  periodClamped: boolean;
  hasUrlFilterParams: boolean;
  error?: string | null;
  ga4Error?: string | null;
  gscPropertyUri: string | null;
  gscCredentialError: string | null;
  /** BR-07 の母集団（フィルタ非依存の全記事）の件数。取得失敗時は null（0件と区別する） */
  annotationTotalCount: number | null;
  /** 実行中の AI要約ジョブの処理済み件数（BR-B07）。未完了ジョブが無ければ null */
  summaryJobProcessedCount: number | null;
  /** 同ジョブの分母。**起票時に固定した対象ID数**で、利用者の全記事数（`annotationTotalCount`）とは別物 */
  summaryJobTotalCount: number | null;
  total: number;
  totalPages: number;
  currentPage: number;
  perPage: number;
  prevHref: string;
  nextHref: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
  startDate: string;
  endDate: string;
  instagramConnected: boolean;
  activeTab: 'blog' | 'instagram';
  instagramItems: InstagramMediaListItem[];
  instagramTotal: number;
  instagramTotalPages: number;
  igPage: number;
  igType: InstagramMediaTypeFilter;
  igStart: string;
  igEnd: string;
  igSort: InstagramMediaSortKey;
  instagramLastSyncedAt: string | null;
  instagramBackfillStatus: 'not_started' | 'in_progress' | 'completed';
  instagramSyncEnabled: boolean;
}

export default function AnalyticsClient({
  items,
  allCategoryNames,
  unreadAnnotationIds,
  selectedCategoryNames,
  includeUncategorized,
  hasUnreadSuggestion,
  hasUnstartedGscEvaluation,
  hasUnsummarized,
  ga4Truncated,
  periodClamped,
  hasUrlFilterParams,
  error,
  ga4Error,
  gscPropertyUri,
  gscCredentialError,
  annotationTotalCount,
  summaryJobProcessedCount,
  summaryJobTotalCount,
  total,
  totalPages,
  currentPage,
  perPage,
  prevHref,
  nextHref,
  prevDisabled,
  nextDisabled,
  startDate,
  endDate,
  instagramConnected,
  activeTab,
  instagramItems,
  instagramTotal,
  instagramTotalPages,
  igPage,
  igType,
  igStart,
  igEnd,
  igSort,
  instagramLastSyncedAt,
  instagramBackfillStatus,
  instagramSyncEnabled,
}: AnalyticsClientProps) {
  const router = useRouter();
  const hrefState: AnalyticsHrefState = {
    currentPage,
    selectedCategoryNames,
    includeUncategorized,
    hasUnreadSuggestion,
    hasUnstartedGscEvaluation,
    hasUnsummarized,
    instagramConnected,
    activeTab,
    igPage,
    igType,
    igStart,
    igEnd,
    igSort,
  };
  const unreadAnnotationSet = React.useMemo(
    () => new Set(unreadAnnotationIds),
    [unreadAnnotationIds]
  );
  const [rangeStart, setRangeStart] = React.useState(startDate);
  const [rangeEnd, setRangeEnd] = React.useState(endDate);
  const [isApplyingDateRange, setIsApplyingDateRange] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [isSelectAll, setIsSelectAll] = React.useState(false);
  // 全選択したまま個別の行だけ外すための除外集合（BR-07「全選択後の個別解除」）。
  // 母集団の ID はクライアントに無いため、全選択を解除して選び直すのではなく除外で表す。
  // isSelectAll が false のときは意味を持たない
  const [excludedIds, setExcludedIds] = React.useState<Set<string>>(() => new Set());
  const [isStarting, setIsStarting] = React.useState(false);
  const [isSummarizing, setIsSummarizing] = React.useState(false);
  const isDateRangeChanged = rangeStart !== startDate || rangeEnd !== endDate;
  // チェック列・全選択・一括ツールバーは常時出す。評価一括と AI 要約一括で1本を共有し
  // （実装メモ §3.1）、要約一括は WordPress 連携が前提で GSC とは無関係なので、
  // GSC 条件を共有列へ持ち込むと GSC 未連携かつ WordPress 連携済みの paid/admin が
  // 要約一括を1件も実行できなくなる（評価親 AC-05c / 要約親 BR-04・AC-02）。
  // admin/paid の限定は /analytics のルートゲート（proxy.ts）で担保済み。
  //
  // GSC 未連携で隠すのは評価固有の操作系だけ。disabled ではなく非表示にする
  // （評価親 AC-05c「『評価サイクルを開始』は表示されない」）。
  const showBulkEvaluationButton = gscPropertyUri !== null;
  // 件数を取れていないと全選択の母集団が確定しないため、全選択だけを止める（行チェックは使える）
  const isAnnotationTotalCountUnavailable = annotationTotalCount === null;
  // 母集団が1000件を超えるときの除外は、丸めた窓（updated_at 降順の先頭1000件）の中に
  // あるとは限らない。その場合でも表示は「1000 / 全 M 件」の丸め表記のままで、
  // 実際に登録される件数はサーバーが ID で突き合わせて確定する
  const rawSelectedCount = resolveRawSelectedCount(
    { selectedIds, excludedIds, isSelectAll },
    annotationTotalCount
  );
  const selectedCount = Math.min(rawSelectedCount, 1000);
  const isSelectionClamped = rawSelectedCount > 1000;

  React.useEffect(() => {
    setRangeStart(startDate);
    setRangeEnd(endDate);
    setIsApplyingDateRange(false);
  }, [startDate, endDate]);

  // 行選択はページ送りをまたいで保持する（実装メモ §3.1。2026-09-03 改訂）。
  // /analytics 内のページ送りは soft navigation で AnalyticsClient がアンマウント
  // されないため、追加の永続化なしに React state のまま残る。
  // 一方、一覧の中身が入れ替わるフィルタ変更では選択を解除する（表示されていない
  // 記事の選択が残るのを防ぐ）。
  const listingKey = React.useMemo(
    () =>
      buildListingSelectionKey({
        selectedCategoryNames,
        includeUncategorized,
        hasUnreadSuggestion,
        hasUnstartedGscEvaluation,
        hasUnsummarized,
      }),
    [
      selectedCategoryNames,
      includeUncategorized,
      hasUnreadSuggestion,
      hasUnstartedGscEvaluation,
      hasUnsummarized,
    ]
  );

  React.useEffect(() => {
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    setIsSelectAll(false);
  }, [listingKey]);

  const applyDateRange = () => {
    if (!isDateRangeChanged || isApplyingDateRange) return;
    setIsApplyingDateRange(true);
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('start', rangeStart);
    params.set('end', rangeEnd);
    for (const name of selectedCategoryNames) {
      const trimmed = name.trim();
      if (trimmed.length > 0) params.append('category', trimmed);
    }
    if (includeUncategorized) params.set('uncategorized', '1');
    if (hasUnreadSuggestion) params.set('unread_suggestion', '1');
    if (hasUnstartedGscEvaluation) params.set('gsc_evaluation', 'not_started');
    if (hasUnsummarized) params.set('unsummarized', '1');
    router.push(`/analytics?${params.toString()}`);
  };
  const startItemNumber = total > 0 ? (currentPage - 1) * perPage + 1 : 0;
  const endItemNumber = total > 0 ? Math.min(currentPage * perPage, total) : 0;

  const startBulkEvaluation = async () => {
    if (!gscPropertyUri || selectedCount < 1 || isStarting) return;

    setIsStarting(true);
    try {
      const result = await registerEvaluationsBulk(
        isSelectAll
          ? { mode: 'all', excludedIds: Array.from(excludedIds) }
          : { mode: 'ids', contentAnnotationIds: Array.from(selectedIds) }
      );

      if (!result.success) {
        toast.error(result.error ?? ERROR_MESSAGES.GSC.BULK_REGISTER_FAILED);
        return;
      }
      if (!result.data) {
        toast.error(ERROR_MESSAGES.GSC.BULK_REGISTER_FAILED);
        return;
      }

      const { registeredCount, skippedAlreadyRegisteredCount, failedCount } = result.data;
      const detail =
        skippedAlreadyRegisteredCount > 0 || failedCount > 0
          ? `（スキップ ${skippedAlreadyRegisteredCount} 件、失敗 ${failedCount} 件）`
          : '';
      toast.success(
        `${registeredCount}件の検索順位・コンテンツ評価サイクルを開始しました${detail}`
      );
      setSelectedIds(new Set());
      setExcludedIds(new Set());
      setIsSelectAll(false);
      router.refresh();
    } catch (error) {
      console.error('[analytics] bulk evaluation failed', error);
      toast.error(ERROR_MESSAGES.GSC.BULK_REGISTER_FAILED);
    } finally {
      setIsStarting(false);
    }
  };

  const startBulkSummary = async () => {
    // 「未要約」フィルタは条件に入れない（2026-08-31 撤廃。BR-04）。
    // 全選択の母集団はフィルタ非依存の全記事（BR-05）なので、フィルタを ON にしても
    // 要約される記事は1件も減らない。ゲートは操作を1段増やすだけで何も守っていなかった。
    // 誤実行を防ぐのはサーバー側の未要約再検証（BR-B08。要約済み・WordPress 未連携は
    // generateSummary を呼ぶ前にスキップするので LLM 費用は発生しない）
    if (selectedCount < 1 || isSummarizing) return;

    setIsSummarizing(true);
    try {
      // 2026-09-04 バックグラウンド化: この呼び出しはジョブを1件起票して即座に返る。
      // 要約そのものは cron が行い、結果は完了メールと進捗表示で受け取る
      const result = await summarizeContentAnnotationsBulk(
        isSelectAll
          ? { mode: 'all', excludedIds: Array.from(excludedIds) }
          : { mode: 'ids', contentAnnotationIds: Array.from(selectedIds) }
      );

      if (!result.success || !result.data) {
        // 二重起票（SUMMARY_BULK_ALREADY_RUNNING）もここに来る。文言はサーバーが確定済み
        toast.error(result.error ?? ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED);
        return;
      }

      toast.success('バックグラウンドで実行します。完了したらメールでお知らせします。');
      setSelectedIds(new Set());
      setExcludedIds(new Set());
      setIsSelectAll(false);
      router.refresh();
    } catch (error) {
      console.error('[analytics] bulk summary enqueue failed', error);
      toast.error(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_FAILED);
    } finally {
      setIsSummarizing(false);
    }
  };

  const toggleRowSelection = (annotationId: string, checked: boolean) => {
    // 全選択中は「全選択を解除して選び直す」のではなく、その1件だけを母集団から除外する。
    // 母集団の ID はクライアントに無いので、解除してしまうと表示中の行以外の選択を復元できない
    if (isSelectAll) {
      setExcludedIds(previous => toggleIdMembership(previous, annotationId, !checked));
      return;
    }
    setSelectedIds(previous => toggleIdMembership(previous, annotationId, checked));
  };

  const toggleAllSelection = (checked: boolean) => {
    if (checked && annotationTotalCount === null) {
      toast.error(ERROR_MESSAGES.GSC.BULK_TOTAL_COUNT_FETCH_FAILED);
      return;
    }
    setIsSelectAll(checked);
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    // 全選択の結果（母集団の件数・1000件への丸め・絞り込み外を含むこと）はツールバーに
    // 常時表示しているため、toast は出さない。消える通知で同じことを二重に言わない
  };

  const blogContent = (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>投稿一覧</CardTitle>
          <button
            id="analytics-field-config-trigger"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-9 inline-flex items-center gap-2 px-3 border-primary text-primary hover:bg-primary/10'
            )}
          >
            <Settings className="w-4 h-4" aria-hidden />
            フィールド構成
          </button>
          <Link
            href="/wordpress-import"
            className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}
          >
            <Download className="w-4 h-4" aria-hidden />
            <span>WordPress記事一括インポート</span>
          </Link>
          <Link
            href="/gsc-import"
            className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}
          >
            <BarChart3 className="w-4 h-4" aria-hidden />
            <span>Google Search Console 日次指標インポート</span>
          </Link>
          <Link
            href="/ga4-dashboard"
            className={cn(
              buttonVariants(),
              'h-9 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700'
            )}
          >
            <TrendingUp className="w-4 h-4" aria-hidden />
            <span>GA4ダッシュボード</span>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="mb-4">
            <ErrorAlert error={error} variant="default" />
          </div>
        ) : null}
        {ga4Error ? (
          <div className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            {ga4Error}
          </div>
        ) : null}
        {gscCredentialError ? (
          <div className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            {gscCredentialError}
          </div>
        ) : null}
        {isAnnotationTotalCountUnavailable ? (
          <div className="mb-4 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            {ERROR_MESSAGES.GSC.BULK_TOTAL_COUNT_FETCH_FAILED}
          </div>
        ) : null}
        {periodClamped ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">表示期間は最大100日に制限されています。</p> : null}
        {ga4Truncated ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">表示期間が長いため、日次データをすべて取得できていません。期間を短くして再表示してください。</p> : null}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">GA4集計開始日</span>
            <Input
              type="date"
              value={rangeStart}
              onChange={event => setRangeStart(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">GA4集計終了日</span>
            <Input
              type="date"
              value={rangeEnd}
              onChange={event => setRangeEnd(event.target.value)}
            />
          </div>
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'h-9 inline-flex items-center gap-2 px-3 border-primary text-primary hover:bg-primary/10'
            )}
            onClick={applyDateRange}
            // 起票のリクエスト中だけ期間変更を止める（起票は即座に返るので実質一瞬）。
            // 要約そのものは cron が行うため、画面を離れても結果は失われない
            disabled={!isDateRangeChanged || isApplyingDateRange || isSummarizing}
          >
            {isApplyingDateRange && <Loader2 className="h-4 w-4 animate-spin" />}
            {isApplyingDateRange ? '適用中...' : '期間を適用'}
          </button>
          {selectedCount >= 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600">
                {isSelectionClamped
                  ? `1000 / 全 ${annotationTotalCount} 件`
                  : isAnnotationTotalCountUnavailable
                    ? `選択中 ${selectedCount} 件`
                    : `選択中 ${selectedCount} 件 / 全 ${annotationTotalCount} 件`}
              </span>
              {showBulkEvaluationButton ? (
                <button
                  type="button"
                  className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}
                  onClick={startBulkEvaluation}
                  disabled={isStarting || isSummarizing}
                >
                  {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isStarting ? '開始中...' : '評価サイクルを開始'}
                </button>
              ) : null}
              <button
                type="button"
                // 単記事の「AIで要約」（ContentAnnotationSummaryAction）と同じ見た目にする。
                // 同じ機能が2箇所にあるので、色とアイコンまで揃えないと別物に見える
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'h-9 inline-flex items-center gap-2 border-purple-200 bg-purple-50 text-purple-900 hover:bg-purple-100 hover:text-purple-900'
                )}
                onClick={startBulkSummary}
                disabled={isSummarizing || isStarting}
                aria-busy={isSummarizing}
              >
                {isSummarizing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    要約中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    AIで要約
                  </>
                )}
              </button>
              {isSelectionClamped ? (
                <span className="text-xs text-gray-500">
                  1000件へ丸めました（残りは行チェックで選択）
                </span>
              ) : null}
              {isSelectAll && selectedCount > total ? (
                <span className="text-xs text-muted-foreground">
                  絞り込み外の記事も含みます（対象外はサーバーがスキップ）
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* 実行中の AI要約ジョブの進捗（BR-B07）。自動更新はしない（再読み込みで最新化）。
            **分母語は「対象」**。すぐ上のツールバーの「全 M 件」は利用者の全記事数で母数が違うため、
            同じ語を使うと全選択時に `1000 / 全 1200 件` と並んで読み違える */}
        {summaryJobProcessedCount !== null && summaryJobTotalCount !== null ? (
          <p className="mb-4 text-sm text-gray-600">
            要約中...（処理済み {summaryJobProcessedCount} / 対象 {summaryJobTotalCount} 件）
          </p>
        ) : null}
        {/* 「平均滞在時間」は ÷sessions。列見出し「滞在時間（平均）」と同じ値で、
            記事詳細の「平均エンゲージメント時間」（÷activeUsers）とは別物 */}
        <p className="mb-4 text-xs text-gray-500">
          指定期間でGA4 指標（平均滞在時間・完読率・エンゲージメント率・キーイベント数・キーイベント率）を集計して表示します。
        </p>
        {!error ? (
          <AnalyticsTable
            items={items}
            allCategoryNames={allCategoryNames}
            unreadAnnotationIds={unreadAnnotationSet}
            selectedCategoryNames={selectedCategoryNames}
            includeUncategorized={includeUncategorized}
            hasUnreadSuggestion={hasUnreadSuggestion}
            hasUnstartedGscEvaluation={hasUnstartedGscEvaluation}
            hasUnsummarized={hasUnsummarized}
            hasUrlFilterParams={hasUrlFilterParams}
            selection={{
              selectedIds,
              excludedIds,
              isSelectAll,
              canSelectAll: !isAnnotationTotalCountUnavailable,
              onToggleRow: toggleRowSelection,
              onToggleAll: toggleAllSelection,
            }}
          />
        ) : null}

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-600">
            {total > 0
              ? `全${total}件中 ${startItemNumber}-${endItemNumber}件を表示（${currentPage}/${totalPages}ページ）`
              : ''}
          </div>
          <div className="flex gap-2">
            <Link
              href={prevHref}
              prefetch={false}
              aria-disabled={prevDisabled}
              tabIndex={prevDisabled ? -1 : undefined}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'px-3',
                prevDisabled && 'pointer-events-none opacity-50'
              )}
            >
              前へ
            </Link>
            <Link
              href={nextHref}
              prefetch={false}
              aria-disabled={nextDisabled}
              tabIndex={nextDisabled ? -1 : undefined}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'px-3',
                nextDisabled && 'pointer-events-none opacity-50'
              )}
            >
              次へ
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="w-full px-4 py-8">
      {!instagramConnected ? (
        <>
          <h1 className="text-3xl font-bold mb-6">コンテンツ一覧</h1>
          {blogContent}
        </>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={value => {
            router.push(
              buildInstagramHref(hrefState, {
                tab: value === 'instagram' ? 'instagram' : 'blog',
              })
            );
          }}
          className="w-full"
        >
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <h1 className="text-3xl font-bold">コンテンツ一覧</h1>
            <TabsList>
              <TabsTrigger value="blog" className="flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                <span>ブログ</span>
              </TabsTrigger>
              <TabsTrigger value="instagram" className="flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4" />
                <span>Instagram</span>
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="blog">{blogContent}</TabsContent>
          <TabsContent value="instagram">
            <InstagramTab
              items={instagramItems}
              total={instagramTotal}
              totalPages={instagramTotalPages}
              igPage={igPage}
              igType={igType}
              igStart={igStart}
              igEnd={igEnd}
              igSort={igSort}
              lastSyncedAt={instagramLastSyncedAt}
              backfillStatus={instagramBackfillStatus}
              syncEnabled={instagramSyncEnabled}
              buildIgPageHref={targetPage => buildIgPageHref(hrefState, targetPage)}
              buildFilterHref={patch => buildIgFilterHref(hrefState, patch)}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
