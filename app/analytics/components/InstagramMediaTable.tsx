'use client';

import * as React from 'react';
import FieldConfigurator from '@/components/FieldConfigurator';
import { InstagramMediaThumbnail } from '@/components/InstagramMediaThumbnail';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
// 記事詳細タブと同じローディング表示。共通部品は既存ファイル内で export する規約
// （growmate-ui-ux SKILL「同種の既存 UI があるときは『そのまま』使う」）のため、OverviewTab から読む
import { CenteredLoading } from '../[annotationId]/components/OverviewTab';
import { StatusFilterOption, StatusFilterSection } from '@/components/CategoryFilter';
import { cn } from '@/lib/utils';
import {
  ANALYTICS_STORAGE_KEYS,
  FIELD_CONFIG_TABLE_KEYS,
  INSTAGRAM_COLUMNS,
  isInstagramSortKey,
} from '@/lib/constants';
import {
  formatCount,
  formatDurationMs,
  formatInstagramRate,
  formatPostedAt,
  formatSkipRate,
  isInstagramEngagementTargetMet,
} from '@/lib/instagram-format';
import type {
  InstagramMediaListItem,
  InstagramMediaSortKey,
  InstagramMediaSortOrder,
} from '@/types/instagram';
import type { StoredFieldConfig } from '@/types/field-config';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, TrendingUp } from 'lucide-react';

interface InstagramMediaTableProps {
  items: InstagramMediaListItem[];
  igSort: InstagramMediaSortKey;
  igOrder: InstagramMediaSortOrder;
  /** 列見出しを押したとき。同じ列なら向きを反転、別の列なら降順から始める（呼び出し側で決める） */
  onSortChange: (sort: InstagramMediaSortKey) => void;
  /** 保存済みのフィールド構成（未保存なら null）。サーバーが読んだ値をそのまま流す */
  fieldConfig: StoredFieldConfig | null;
  onSortColumnHidden: () => void;
  igHigh: boolean;
  onHighOnlyChange: (checked: boolean) => void;
  criteriaLabel: string | null;
  targetMinRate: number | null;
  /**
   * items が空のときに表示するメッセージ。
   * items が空でもこのコンポーネント（＝内包する FieldConfigurator）は必ずマウントする必要がある。
   * 呼び出し元で items===0 のときにこのコンポーネント自体を描画しないと、
   * FieldConfigurator の外部トリガー（id="instagram-field-config-trigger"）用の
   * クリックリスナーが登録されず、投稿0件時に「フィールド構成」ボタンが無反応になる。
   */
  emptyMessage: string;
  /** 取得中の文言。null でないとき、0件なら emptyMessage の代わりにスピナーを出す */
  loadingLabel: string | null;
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

function ThumbnailCell({ item }: { item: InstagramMediaListItem }) {
  return (
    <div className="relative w-12 h-12 rounded overflow-hidden">
      <InstagramMediaThumbnail
        igMediaId={item.igMediaId}
        className="object-cover"
        fallback={<div className="w-12 h-12 rounded bg-gray-100" />}
      />
    </div>
  );
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
          {/*
            tabIndex/button 化しないと hover 専用になり、キーボードとタッチでは
            「対象外」の理由に到達できない。既定が全期間になり、指標を取得できない
            古い投稿が初期表示に並ぶようになったため実際に踏まれる
          */}
          <TooltipTrigger asChild>
            <span tabIndex={0} role="button" className="text-gray-500 underline decoration-dotted">
              対象外
            </span>
          </TooltipTrigger>
          <TooltipContent>{unavailableTooltip(item.insightsUnavailableReason)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <span>{value}</span>;
}

/** 率の列（DB の生成列）。並べ替えと同じ値を表示する */
function RateCell({ item, value }: { item: InstagramMediaListItem; value: number | null }) {
  if (item.insightsUnavailable) {
    return <MetricCell item={item} value="-" />;
  }
  return <span>{formatInstagramRate(value)}</span>;
}

export default function InstagramMediaTable({
  items,
  igSort,
  igOrder,
  onSortChange,
  fieldConfig,
  onSortColumnHidden,
  emptyMessage,
  loadingLabel,
  igHigh,
  onHighOnlyChange,
  criteriaLabel,
  targetMinRate,
}: InstagramMediaTableProps) {
  const columns = React.useMemo(() => INSTAGRAM_COLUMNS.map(col => ({ ...col })), []);

  const handleConfiguratorChange = React.useCallback(
    (visibleIds: string[], _orderedIds: string[]) => {
      void _orderedIds;
      if (!visibleIds.includes(igSort)) {
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
      case 'engagement_rate': {
        const targetMet =
          !item.insightsUnavailable &&
          isInstagramEngagementTargetMet(
            item.engagementRate,
            targetMinRate === null ? null : { min: targetMinRate }
          );
        return (
          <div className="flex items-center gap-2">
            <RateCell item={item} value={item.engagementRate} />
            {targetMet ? <Badge variant="secondary">目標達成</Badge> : null}
          </div>
        );
      }
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
        return <RateCell item={item} value={item.likeRate} />;
      case 'saved_rate':
        return <RateCell item={item} value={item.savedRate} />;
      case 'share_rate':
        return <RateCell item={item} value={item.shareRate} />;
      case 'comment_rate':
        return <RateCell item={item} value={item.commentRate} />;
      case 'repost_rate':
        return <RateCell item={item} value={item.repostRate} />;
      default:
        return '—';
    }
  };

  return (
    <FieldConfigurator
      columns={columns}
      tableKey={FIELD_CONFIG_TABLE_KEYS.INSTAGRAM_MEDIA}
      initialConfig={fieldConfig}
      legacyStorageKey={ANALYTICS_STORAGE_KEYS.IG_VISIBLE_COLUMNS}
      onChange={handleConfiguratorChange}
      triggerId="instagram-field-config-trigger"
      hideTrigger
      dialogExtraContent={
        criteriaLabel === null ? undefined : (
          // ブログ一覧と同じ部品を使う（src/components/CategoryFilter.tsx）
          <div className="space-y-3">
            <StatusFilterSection>
              <StatusFilterOption
                checked={igHigh}
                onCheckedChange={onHighOnlyChange}
                icon={TrendingUp}
                label="高エンゲージメント率"
                tone="blue"
              >
                <li>エンゲージメント率が目標の下限以上の投稿だけが対象です（{criteriaLabel}）。</li>
                <li>エンゲージメント率は（いいね＋コメント＋保存）÷ リーチ × 100 です。</li>
                <li>フォロワー数は最後に取得した時点の値です。</li>
              </StatusFilterOption>
            </StatusFilterSection>
          </div>
        )
      }
    >
      {({ visibleSet, orderedIds }) => {
        if (items.length === 0) {
          // role="status" の要素は取得中→空状態のあいだ差し替えずに置いたままにする。
          // 中身の入った live region を新しく差し込むと読み上げられないスクリーンリーダーが多く、
          // 取得完了後の「まだ投稿がありません」などが伝わらなくなる
          return (
            <div role="status" className="py-8">
              {loadingLabel !== null ? (
                <CenteredLoading label={loadingLabel} />
              ) : (
                <p className="text-sm text-gray-500 text-center">{emptyMessage}</p>
              )}
            </div>
          );
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
                    const label = col?.label ?? columnId;
                    // 並べ替えキーは DB の列名。対応する列が無い見出しは押せない
                    if (!isInstagramSortKey(columnId)) {
                      return (
                        <th key={columnId} className="px-6 py-3 whitespace-nowrap">
                          {label}
                        </th>
                      );
                    }
                    const isActive = columnId === igSort;
                    const SortIcon = !isActive
                      ? ArrowUpDown
                      : igOrder === 'asc'
                        ? ArrowUp
                        : ArrowDown;
                    return (
                      <th
                        key={columnId}
                        aria-sort={
                          isActive ? (igOrder === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                        className="px-6 py-3 whitespace-nowrap"
                      >
                        {/*
                          見出しの文字だけを押せる範囲にするため素の button を使う（ui/button は
                          高さ・余白を持ち、見出しの行の高さと既存の見出しとの揃いが崩れる）。
                          既存の QueryAnalysisTab は <th onClick> でキーボードから押せないため写さない
                        */}
                        <button
                          type="button"
                          onClick={() => onSortChange(columnId)}
                          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {label}
                          <SortIcon className="w-3 h-3" aria-hidden />
                        </button>
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
                      <ThumbnailCell item={item} />
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
