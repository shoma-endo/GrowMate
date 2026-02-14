'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AnalyticsTable from '@/components/AnalyticsTable';
import { Download, Settings, BarChart3, Loader2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorAlert } from '@/components/ErrorAlert';
import type { AnalyticsContentItem } from '@/types/analytics';
import { useRouter } from 'next/navigation';

interface AnalyticsClientProps {
  items: AnalyticsContentItem[];
  unreadAnnotationIds: string[];
  error?: string | null;
  ga4Error?: string | null;
  total: number;
  totalPages: number;
  currentPage: number;
  prevHref: string;
  nextHref: string;
  prevDisabled: boolean;
  nextDisabled: boolean;
  startDate: string;
  endDate: string;
}

export default function AnalyticsClient({
  items,
  unreadAnnotationIds,
  error,
  ga4Error,
  total,
  totalPages,
  currentPage,
  prevHref,
  nextHref,
  prevDisabled,
  nextDisabled,
  startDate,
  endDate,
}: AnalyticsClientProps) {
  const router = useRouter();
  const unreadAnnotationSet = React.useMemo(
    () => new Set(unreadAnnotationIds),
    [unreadAnnotationIds]
  );
  const shouldRenderTable = items.length > 0;
  const [rangeStart, setRangeStart] = React.useState(startDate);
  const [rangeEnd, setRangeEnd] = React.useState(endDate);
  const [isApplyingDateRange, setIsApplyingDateRange] = React.useState(false);
  const isDateRangeChanged = rangeStart !== startDate || rangeEnd !== endDate;

  React.useEffect(() => {
    setRangeStart(startDate);
    setRangeEnd(endDate);
    setIsApplyingDateRange(false);
  }, [startDate, endDate]);

  const applyDateRange = () => {
    if (!isDateRangeChanged || isApplyingDateRange) return;
    setIsApplyingDateRange(true);
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('start', rangeStart);
    params.set('end', rangeEnd);
    router.push(`/analytics?${params.toString()}`);
  };

  return (
    <div className="w-full px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">コンテンツ一覧</h1>

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
              className={cn(buttonVariants(), 'h-9 inline-flex items-center gap-2')}
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
          </div>
          <p className="mb-4 text-xs text-gray-500">
            指定期間でGA4指標（滞在時間・読了率・直帰率・CV数・CVR）を集計して表示します。
          </p>
          {shouldRenderTable ? (
            <AnalyticsTable
              items={items}
              unreadAnnotationIds={unreadAnnotationSet}
            />
          ) : error ? null : (
            <div className="text-center py-8 text-gray-500">投稿が見つかりません</div>
          )}

          {/* ページネーション */}
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-gray-600">
              {total > 0 ? `全${total}件 / ${currentPage}ページ目（${totalPages}ページ）` : ''}
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
    </div>
  );
}
