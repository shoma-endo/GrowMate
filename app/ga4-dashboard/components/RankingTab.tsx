'use client';

import Link from 'next/link';
import type { Ga4DashboardRankingItem } from '@/types/ga4';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { annotationDetailPath } from '@/lib/routes';

interface Props {
  items: Ga4DashboardRankingItem[];
  /** ページングを適用する前の総パス数 */
  totalCount: number;
  /** 現在のページ先頭の位置（0始まり） */
  offset: number;
  pageSize: number;
  isLoading?: boolean;
  selectedNormalizedPath?: string;
  onRowClick: (item: Ga4DashboardRankingItem) => void;
  onPageChange: (nextOffset: number) => void;
}

export function RankingTab({
  items,
  totalCount,
  offset,
  pageSize,
  isLoading,
  selectedNormalizedPath,
  onRowClick,
  onPageChange,
}: Props) {
  const formatNumber = (num: number) => num.toLocaleString();
  // null は「90%スクロールイベントが未計測」。0.0% と書かない（BR-02）
  const formatPercent = (num: number | null) => (num === null ? '-' : `${num.toFixed(1)}%`);
  const formatDuration = (sec: number) => {
    if (sec === 0) return '0秒';
    const avgSec = Math.round(sec);
    if (avgSec < 60) return `${avgSec}秒`;
    const min = Math.floor(avgSec / 60);
    return `${min}分`;
  };

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const currentPage = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;
  const hasSampledItem = items.some(item => item.isSampled);
  const hasPartialItem = items.some(item => item.isPartial);

  if (items.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12 text-gray-500">
        データがありません。GA4データを同期してください。
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', isLoading && 'opacity-50 pointer-events-none')}>
      {/* テーブルヘッダー・デスクトップのみ */}
      <div className="hidden md:grid grid-cols-6 gap-4 px-4 py-2 bg-gray-50 rounded-t-lg text-sm font-medium text-gray-700">
        <div>ページ</div>
        <div className="text-right">セッション</div>
        <div className="text-right">問い合わせ率</div>
        <div className="text-right">完読率</div>
        <div className="text-right">滞在時間</div>
        <div className="text-center">品質</div>
      </div>

      {/* テーブルボディー */}
      <div className="space-y-2">
        {items.map((item) => {
          const isSelected = item.normalizedPath === selectedNormalizedPath;

          return (
            <div
              key={item.normalizedPath}
              onClick={() => onRowClick(item)}
              className={cn(
                'grid grid-cols-1 md:grid-cols-6 gap-2 md:gap-4 px-4 py-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50',
                isSelected && 'bg-blue-50 border-blue-500 ring-1 ring-blue-500'
              )}
            >
              {/* パス・タイトル */}
              <div className="col-span-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isSelected && (
                    <span className="text-blue-600 font-bold text-sm shrink-0">
                      ▶
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    {item.annotationId ? (
                      <Link
                        href={annotationDetailPath(item.annotationId)}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-blue-600 hover:underline truncate block"
                      >
                        {item.title || item.normalizedPath}
                      </Link>
                    ) : (
                      <span className="truncate block text-sm" title={item.normalizedPath}>
                        {item.normalizedPath}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1 md:hidden">
                  セッション: {formatNumber(item.sessions)}
                </div>
              </div>

              {/* セッション */}
              <div className="hidden md:block text-right">
                <div className="font-medium text-gray-900">
                  {formatNumber(item.sessions)}
                </div>
              </div>

              {/* 問い合わせ率 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">{formatPercent(item.cvr)}</div>
                <div className="text-xs text-gray-500">
                  問い合わせ: {formatNumber(item.cvEventCount)}
                </div>
              </div>

              {/* 完読率 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">{formatPercent(item.readRate)}</div>
              </div>

              {/* 滞在時間 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">
                  {formatDuration(item.avgEngagementTimeSec)}
                </div>
              </div>

              {/* 品質フラグ・モバイルでは横に並べる */}
              <div className="col-span-1 flex md:justify-center items-center gap-1 md:gap-2">
                {(item.isSampled || item.isPartial) && (
                  <div className="flex md:flex-col gap-1">
                    {item.isSampled && (
                      <Badge variant="secondary" className="text-xs">
                        サンプリング
                      </Badge>
                    )}
                    {item.isPartial && (
                      <Badge variant="outline" className="text-xs">
                        一部取得
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ページ送り */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="text-sm text-gray-600">
            {formatNumber(totalCount)}件中 {formatNumber(offset + 1)}〜
            {formatNumber(Math.min(offset + items.length, totalCount))}件を表示
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || offset <= 0}
              onClick={() => onPageChange(Math.max(0, offset - pageSize))}
            >
              前へ
            </Button>
            <span className="text-sm text-gray-600">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || offset + pageSize >= totalCount}
              onClick={() => onPageChange(offset + pageSize)}
            >
              次へ
            </Button>
          </div>
        </div>
      )}

      {/* 注釈。バッジの凡例は、実際にバッジが付いた行があるときだけ出す */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        <ul className="list-disc list-inside space-y-1">
          <li>
            クリックすると時系列グラフが表示されます（タイトルをクリックすると記事の詳細画面に移動します）
          </li>
          {hasSampledItem && (
            <li>
              サンプリング: GA4データがサンプリングされている期間を含みます
            </li>
          )}
          {hasPartialItem && (
            <li>
              一部取得: GA4からの取得が上限（50,000行）に達したため一部が未取得です
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
