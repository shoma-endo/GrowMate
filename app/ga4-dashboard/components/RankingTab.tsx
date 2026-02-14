'use client';

import Link from 'next/link';
import type { Ga4DashboardRankingItem } from '@/types/ga4';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  items: Ga4DashboardRankingItem[];
  isLoading?: boolean;
  selectedNormalizedPath?: string;
  onRowClick: (item: Ga4DashboardRankingItem) => void;
}

export function RankingTab({
  items,
  isLoading,
  selectedNormalizedPath,
  onRowClick,
}: Props) {
  const formatNumber = (num: number) => num.toLocaleString();
  const formatPercent = (num: number) => `${num.toFixed(1)}%`;
  const formatDuration = (sec: number) => {
    if (sec === 0) return '0秒';
    const avgSec = Math.round(sec);
    if (avgSec < 60) return `${avgSec}秒`;
    const min = Math.floor(avgSec / 60);
    return `${min}分`;
  };

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
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-2 bg-gray-50 rounded-t-lg text-sm font-medium text-gray-700">
        <div>ページ</div>
        <div className="text-right">セッション</div>
        <div className="text-right">CVR</div>
        <div className="text-right">読了率</div>
        <div className="text-right">滞在時間</div>
        <div className="text-right">直帰率</div>
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
                'grid grid-cols-1 md:grid-cols-7 gap-2 md:gap-4 px-4 py-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50',
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
                        href={`/analytics?annotationId=${item.annotationId}`}
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

              {/* セッション数 */}
              <div className="hidden md:block text-right">
                <div className="font-medium text-gray-900">
                  {formatNumber(item.sessions)}
                </div>
              </div>

              {/* CVR */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">{formatPercent(item.cvr)}</div>
                <div className="text-xs text-gray-500">
                  CV: {formatNumber(item.cvEventCount)}
                </div>
              </div>

              {/* 読了率 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">{formatPercent(item.readRate)}</div>
              </div>

              {/* 滞在時間 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">
                  {formatDuration(item.avgEngagementTimeSec)}
                </div>
              </div>

              {/* 直帰率 */}
              <div className="hidden md:block text-right">
                <div className="text-gray-700">
                  {formatPercent(item.bounceRate * 100)}
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

      {/* 注釈 */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        <ul className="list-disc list-inside space-y-1">
          <li>
            クリックすると時系列グラフが表示されます（Analytics画面の記事に飛ぶこともできます）
          </li>
          <li>
            サンプリング: GA4データがサンプリングされている期間を含みます
          </li>
          <li>
            一部取得: データ取得上限（50,000行）に達したため一部が未取得です
          </li>
        </ul>
      </div>
    </div>
  );
}
