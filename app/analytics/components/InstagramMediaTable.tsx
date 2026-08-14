'use client';

import * as React from 'react';
import Image from 'next/image';
import FieldConfigurator from '@/components/FieldConfigurator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ANALYTICS_STORAGE_KEYS, INSTAGRAM_COLUMNS } from '@/lib/constants';
import {
  calculateInstagramRate,
  formatCount,
  formatDurationMs,
  formatInstagramRate,
  formatPostedAt,
  formatSkipRate,
} from '@/lib/instagram-format';
import type { InstagramMediaListItem, InstagramMediaSortKey } from '@/types/instagram';
import { ExternalLink } from 'lucide-react';

const SORTABLE_COLUMN_IDS = new Set<InstagramMediaSortKey>(['posted_at', 'reach', 'views']);

interface InstagramMediaTableProps {
  items: InstagramMediaListItem[];
  igSort: InstagramMediaSortKey;
  onSortColumnHidden: () => void;
  /**
   * items が空のときに表示するメッセージ。
   * items が空でもこのコンポーネント（＝内包する FieldConfigurator）は必ずマウントする必要がある。
   * 呼び出し元で items===0 のときにこのコンポーネント自体を描画しないと、
   * FieldConfigurator の外部トリガー（id="instagram-field-config-trigger"）用の
   * クリックリスナーが登録されず、投稿0件時に「フィールド構成」ボタンが無反応になる。
   */
  emptyMessage: string;
}

function captionPreview(caption: string | null): string {
  if (!caption) {
    return '—';
  }
  const trimmed = caption.trim();
  if (trimmed.length <= 40) {
    return trimmed;
  }
  return `${trimmed.slice(0, 40)}…`;
}

function unavailableTooltip(reason: InstagramMediaListItem['insightsUnavailableReason']): string {
  if (reason === 'pre_conversion') {
    return 'プロアカウント転換前の投稿のため取得できません';
  }
  if (reason === 'retention_expired') {
    return '投稿から2年以上経過しているため取得できません';
  }
  return '指標を取得できません';
}

function MetricCell({
  item,
  value,
}: {
  item: InstagramMediaListItem;
  value: string;
}) {
  if (item.insightsUnavailable) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-gray-500">対象外</span>
          </TooltipTrigger>
          <TooltipContent>{unavailableTooltip(item.insightsUnavailableReason)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <span>{value}</span>;
}

function RateCell({
  item,
  numerator,
  label,
}: {
  item: InstagramMediaListItem;
  numerator: number | null;
  label: string;
}) {
  if (item.insightsUnavailable) {
    return <MetricCell item={item} value="-" />;
  }
  const rate = calculateInstagramRate(numerator, item.reach);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{formatInstagramRate(rate)}</span>
        </TooltipTrigger>
        <TooltipContent>
          Instagram 非公式の GrowMate 独自計算（{label}）。Instagram
          アプリの表示と一致しない場合があります
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function InstagramMediaTable({
  items,
  igSort,
  onSortColumnHidden,
  emptyMessage,
}: InstagramMediaTableProps) {
  const columns = React.useMemo(() => INSTAGRAM_COLUMNS.map(col => ({ ...col })), []);

  const handleConfiguratorChange = React.useCallback(
    (visibleIds: string[], _orderedIds: string[]) => {
      void _orderedIds;
      if (!SORTABLE_COLUMN_IDS.has(igSort)) {
        return;
      }
      const sortColumnId =
        igSort === 'posted_at' ? 'posted_at' : igSort === 'reach' ? 'reach' : 'views';
      if (!visibleIds.includes(sortColumnId)) {
        onSortColumnHidden();
      }
    },
    [igSort, onSortColumnHidden]
  );

  const renderCell = (columnId: string, item: InstagramMediaListItem): React.ReactNode => {
    switch (columnId) {
      case 'media_product_type':
        return item.mediaProductType === 'REELS' ? 'リール' : 'フィード';
      case 'caption':
        return captionPreview(item.caption);
      case 'posted_at':
        return formatPostedAt(item.postedAt);
      case 'reach':
        return <MetricCell item={item} value={formatCount(item.reach)} />;
      case 'views':
        return <MetricCell item={item} value={formatCount(item.views)} />;
      case 'like_count':
        return <MetricCell item={item} value={formatCount(item.likeCount)} />;
      case 'comments_count':
        return <MetricCell item={item} value={formatCount(item.commentsCount)} />;
      case 'saved':
        return <MetricCell item={item} value={formatCount(item.saved)} />;
      case 'shares':
        return <MetricCell item={item} value={formatCount(item.shares)} />;
      case 'reposts':
        return <MetricCell item={item} value={formatCount(item.reposts)} />;
      case 'total_interactions':
        return <MetricCell item={item} value={formatCount(item.totalInteractions)} />;
      case 'avg_watch_time_ms':
        return (
          <MetricCell
            item={item}
            value={item.mediaProductType === 'REELS' ? formatDurationMs(item.avgWatchTimeMs) : '-'}
          />
        );
      case 'total_watch_time_ms':
        return (
          <MetricCell
            item={item}
            value={
              item.mediaProductType === 'REELS' ? formatDurationMs(item.totalWatchTimeMs) : '-'
            }
          />
        );
      case 'reels_skip_rate':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <MetricCell
                    item={item}
                    value={
                      item.mediaProductType === 'REELS'
                        ? formatSkipRate(item.reelsSkipRate)
                        : '-'
                    }
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Instagram が提供する値（3秒以内にスキップされた再生数 ÷
                初回再生数）。推定値・開発中の指標のため変動することがあります
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'like_rate':
        return <RateCell item={item} numerator={item.likeCount} label="いいね数 ÷ リーチ数" />;
      case 'saved_rate':
        return <RateCell item={item} numerator={item.saved} label="保存数 ÷ リーチ数" />;
      case 'share_rate':
        return <RateCell item={item} numerator={item.shares} label="シェア数 ÷ リーチ数" />;
      case 'comment_rate':
        return (
          <RateCell item={item} numerator={item.commentsCount} label="コメント数 ÷ リーチ数" />
        );
      case 'repost_rate':
        return <RateCell item={item} numerator={item.reposts} label="再投稿数 ÷ リーチ数" />;
      default:
        return '—';
    }
  };

  return (
    <FieldConfigurator
      columns={columns}
      storageKey={ANALYTICS_STORAGE_KEYS.IG_VISIBLE_COLUMNS}
      onChange={handleConfiguratorChange}
      triggerId="instagram-field-config-trigger"
      hideTrigger
    >
      {({ visibleSet, orderedIds }) => {
        if (items.length === 0) {
          return <p className="text-sm text-gray-500 py-8 text-center">{emptyMessage}</p>;
        }
        const visibleOrdered = orderedIds.filter(id => visibleSet.has(id));
        // contain-layout: table 要素の auto レイアウト計算（列幅の内容依存計算）は、
        // overflow-x-auto や min-w-0 だけでは祖先への伝播を防ぎきれず、documentElement
        // のスクロール幅にまで影響してページ全体が横スクロールしてしまう
        // （Chromium の既知の挙動）。contain: layout でこの要素を独立したレイアウト
        // コンテキストにし、内部の table サイズ計算が外へ影響しないようにする。
        return (
          <div className="overflow-x-auto contain-layout">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600">
                  <th className="px-6 py-3 whitespace-nowrap">サムネ</th>
                  {visibleOrdered.map(columnId => {
                    const col = columns.find(c => c.id === columnId);
                    return (
                      <th key={columnId} className="px-6 py-3 whitespace-nowrap">
                        {col?.label ?? columnId}
                      </th>
                    );
                  })}
                  <th className="px-6 py-3 whitespace-nowrap">リンク</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map(item => (
                  <tr key={item.id} className="align-top">
                    <td className="px-6 py-4">
                      {item.thumbnailUrl || item.mediaUrl ? (
                        <Image
                          src={item.thumbnailUrl ?? item.mediaUrl ?? ''}
                          alt=""
                          width={48}
                          height={48}
                          className="rounded object-cover w-12 h-12"
                          unoptimized
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-100" />
                      )}
                    </td>
                    {visibleOrdered.map(columnId => (
                      <td key={columnId} className="px-6 py-4 whitespace-nowrap">
                        {renderCell(columnId, item)}
                      </td>
                    ))}
                    <td className="px-6 py-4">
                      <a
                        href={item.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 px-2')}
                      >
                        <ExternalLink className="w-4 h-4" aria-hidden />
                        <span className="sr-only">Instagramで開く</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }}
    </FieldConfigurator>
  );
}
