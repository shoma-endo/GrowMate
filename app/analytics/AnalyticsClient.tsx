'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AnalyticsTable from '@/components/AnalyticsTable';
import InstagramTab from './components/InstagramTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Settings, BarChart3, Loader2, TrendingUp, FileText, ImageIcon } from 'lucide-react';
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
  ga4Truncated: boolean;
  periodClamped: boolean;
  hasUrlFilterParams: boolean;
  error?: string | null;
  ga4Error?: string | null;
  gscPropertyUri: string | null;
  gscCredentialError: string | null;
  /** BR-07 の母集団（フィルタ非依存の全記事）の件数。取得失敗時は null（0件と区別する） */
  annotationTotalCount: number | null;
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
  ga4Truncated,
  periodClamped,
  hasUrlFilterParams,
  error,
  ga4Error,
  gscPropertyUri,
  gscCredentialError,
  annotationTotalCount,
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
  const [isStarting, setIsStarting] = React.useState(false);
  const isDateRangeChanged = rangeStart !== startDate || rangeEnd !== endDate;
  // 要約一括が同居する場合は、AC-05c に従いこの条件を常時表示へ切り替える。
  const showCheckColumn = gscPropertyUri !== null;
  // 件数を取れていないと全選択の母集団が確定しないため、全選択だけを止める（行チェックは使える）
  const isAnnotationTotalCountUnavailable = annotationTotalCount === null;
  const rawSelectedCount = isSelectAll ? (annotationTotalCount ?? 0) : selectedIds.size;
  const selectedCount = Math.min(rawSelectedCount, 1000);
  const isSelectionClamped = rawSelectedCount > 1000;

  React.useEffect(() => {
    setRangeStart(startDate);
    setRangeEnd(endDate);
    setIsApplyingDateRange(false);
  }, [startDate, endDate]);

  // 行選択のスコープは表示中ページ内（実装メモ §3.1）。ページ送りだけでなく、
  // 一覧の中身が入れ替わるフィルタ変更でも選択を解除する（1ページ目のままフィルタだけ
  // 変えたときに、表示されていない記事の選択が残るのを防ぐ）。
  const listingKey = React.useMemo(
    () =>
      buildListingSelectionKey({
        currentPage,
        selectedCategoryNames,
        includeUncategorized,
        hasUnreadSuggestion,
        hasUnstartedGscEvaluation,
      }),
    [
      currentPage,
      selectedCategoryNames,
      includeUncategorized,
      hasUnreadSuggestion,
      hasUnstartedGscEvaluation,
    ]
  );

  React.useEffect(() => {
    setSelectedIds(new Set());
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
          ? { mode: 'all' }
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
      setIsSelectAll(false);
      router.refresh();
    } catch (error) {
      console.error('[analytics] bulk evaluation failed', error);
      toast.error(ERROR_MESSAGES.GSC.BULK_REGISTER_FAILED);
    } finally {
      setIsStarting(false);
    }
  };

  const toggleRowSelection = (annotationId: string, checked: boolean) => {
    setIsSelectAll(false);
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (checked) {
        next.add(annotationId);
      } else {
        next.delete(annotationId);
      }
      return next;
    });
  };

  const toggleAllSelection = (checked: boolean) => {
    if (checked && annotationTotalCount === null) {
      toast.error(ERROR_MESSAGES.GSC.BULK_TOTAL_COUNT_FETCH_FAILED);
      return;
    }
    setIsSelectAll(checked);
    setSelectedIds(new Set());
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
        {showCheckColumn && isAnnotationTotalCountUnavailable ? (
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
            disabled={!isDateRangeChanged || isApplyingDateRange}
          >
            {isApplyingDateRange && <Loader2 className="h-4 w-4 animate-spin" />}
            {isApplyingDateRange ? '適用中...' : '期間を適用'}
          </button>
          {showCheckColumn && selectedCount >= 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600">
                {isSelectionClamped
                  ? `1000 / 全 ${annotationTotalCount} 件`
                  : isAnnotationTotalCountUnavailable
                    ? `選択中 ${selectedCount} 件`
                    : `選択中 ${selectedCount} 件 / 全 ${annotationTotalCount} 件`}
              </span>
              <button
                type="button"
                className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}
                onClick={startBulkEvaluation}
                disabled={isStarting || !gscPropertyUri}
              >
                {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isStarting ? '開始中...' : '評価サイクルを開始'}
              </button>
              {isSelectionClamped ? (
                <span className="text-xs text-gray-500">
                  1000件へ丸めました（残りは行チェックで選択）
                </span>
              ) : null}
              {isSelectAll && selectedCount > total ? (
                <span className="text-xs text-gray-500">
                  絞り込み外の記事も含みます（既登録はサーバーがスキップ）
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
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
            hasUrlFilterParams={hasUrlFilterParams}
            {...(showCheckColumn
              ? {
                  selection: {
                    selectedIds,
                    isSelectAll,
                    canSelectAll: !isAnnotationTotalCountUnavailable,
                    onToggleRow: toggleRowSelection,
                    onToggleAll: toggleAllSelection,
                  },
                }
              : {})}
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
