'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, Settings, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getInstagramSyncToastMessage } from '@/lib/instagram-sync';
import { syncInstagramData } from '@/server/actions/instagramSync.actions';
import type {
  InstagramAccountInsightsDailyRow,
  InstagramMediaListItem,
  InstagramMediaSortKey,
  InstagramMediaTypeFilter,
} from '@/types/instagram';
import InstagramAccountSummaryCard from './InstagramAccountSummaryCard';
import InstagramMediaTable from './InstagramMediaTable';

interface InstagramTabProps {
  items: InstagramMediaListItem[];
  total: number;
  totalPages: number;
  igPage: number;
  igType: InstagramMediaTypeFilter;
  igStart: string;
  igEnd: string;
  igSort: InstagramMediaSortKey;
  accountLatestDay: InstagramAccountInsightsDailyRow | null;
  lastSyncedAt: string | null;
  syncEnabled: boolean;
  buildIgPageHref: (targetPage: number) => string;
  buildFilterHref: (patch: {
    igType?: InstagramMediaTypeFilter;
    igStart?: string;
    igEnd?: string;
    igSort?: InstagramMediaSortKey;
    igPage?: number;
  }) => string;
}

function formatLastSyncedAt(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function InstagramTab({
  items,
  total,
  totalPages,
  igPage,
  igType,
  igStart,
  igEnd,
  igSort,
  accountLatestDay,
  lastSyncedAt,
  syncEnabled,
  buildIgPageHref,
  buildFilterHref,
}: InstagramTabProps) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [syncAlert, setSyncAlert] = React.useState<string | null>(null);
  const [rangeStart, setRangeStart] = React.useState(igStart);
  const [rangeEnd, setRangeEnd] = React.useState(igEnd);

  React.useEffect(() => {
    setRangeStart(igStart);
    setRangeEnd(igEnd);
  }, [igStart, igEnd]);

  const lastSyncedLabel = formatLastSyncedAt(lastSyncedAt);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncAlert(null);
    const toastId = toast.loading('Instagramデータを取得中...');
    try {
      const result = await syncInstagramData();
      if (!result.success || !result.data) {
        if (result.needsReauth) {
          toast.error(result.error, { id: toastId });
          setSyncAlert(ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED);
        } else {
          toast.error(result.error, { id: toastId });
        }
        return;
      }
      // needsReauth は success:false と必ずセットで返るため（instagramSync.actions.ts）、
      // ここに到達した時点では常に undefined。渡す必要はない。
      const toastMessage = getInstagramSyncToastMessage(result.data);
      switch (toastMessage.type) {
        case 'warning':
          toast.warning(toastMessage.message, { id: toastId });
          setSyncAlert(ERROR_MESSAGES.INSTAGRAM.API_ERROR);
          break;
        case 'info':
          toast.info(toastMessage.message, { id: toastId });
          break;
        case 'error':
          toast.error(toastMessage.message, { id: toastId });
          break;
        case 'success':
          toast.success(toastMessage.message, { id: toastId });
          break;
      }
      if (result.data.failed > 0) {
        setSyncAlert(ERROR_MESSAGES.INSTAGRAM.PARTIAL_MEDIA_FAILURE(result.data.failed));
      }
      router.refresh();
    } catch (error) {
      console.error('[Instagram Tab] sync failed', error);
      toast.error(ERROR_MESSAGES.INSTAGRAM.SYNC_FAILED, { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  const applyDateRange = () => {
    router.push(
      buildFilterHref({ igStart: rangeStart, igEnd: rangeEnd, igPage: 1 })
    );
  };

  const resetSortIfHidden = () => {
    router.push(buildFilterHref({ igSort: 'posted_at', igPage: 1 }));
  };

  const prevHref = buildIgPageHref(Math.max(1, igPage - 1));
  const nextHref = buildIgPageHref(Math.min(totalPages, igPage + 1));
  const prevDisabled = igPage <= 1;
  const nextDisabled = igPage >= totalPages;
  const startItemNumber = total > 0 ? (igPage - 1) * 10 + 1 : 0;
  const endItemNumber = total > 0 ? Math.min(igPage * 10, total) : 0;

  return (
    <div className="space-y-4 mt-6">
      <div className="flex flex-wrap items-end gap-3 border rounded-lg p-4 bg-gray-50/50">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">種別</span>
          <Select
            value={igType}
            onValueChange={value =>
              router.push(
                buildFilterHref({ igType: value as InstagramMediaTypeFilter, igPage: 1 })
              )
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて</SelectItem>
              <SelectItem value="reels">リール</SelectItem>
              <SelectItem value="feed">フィード</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">開始日</span>
          <Input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">終了日</span>
          <Input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={applyDateRange}>
          期間を適用
        </Button>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">並び順</span>
          <Select
            value={igSort}
            onValueChange={value =>
              router.push(
                buildFilterHref({ igSort: value as InstagramMediaSortKey, igPage: 1 })
              )
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="posted_at">投稿日</SelectItem>
              <SelectItem value="reach">リーチ</SelectItem>
              <SelectItem value="views">視聴数</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!syncEnabled || isSyncing}
          onClick={handleSync}
        >
          <RefreshCw className={cn('w-4 h-4 mr-2', isSyncing && 'animate-spin')} />
          最新化
        </Button>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-9 inline-flex items-center gap-2 px-3 border-primary text-primary hover:bg-primary/10'
          )}
          id="instagram-field-config-trigger"
        >
          <Settings className="w-4 h-4" aria-hidden />
          フィールド構成
        </button>
        {lastSyncedLabel ? (
          <p className="text-xs text-gray-500 ml-auto">最終同期: {lastSyncedLabel}</p>
        ) : null}
      </div>

      {!syncEnabled ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Instagramの同期を一時停止しています
        </div>
      ) : null}

      {syncAlert ? (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          {syncAlert}
          {syncAlert === ERROR_MESSAGES.INSTAGRAM.AUTH_EXPIRED ? (
            <Link href="/setup/instagram" className="ml-2 underline font-medium">
              連携設定へ
            </Link>
          ) : null}
        </div>
      ) : null}

      {accountLatestDay ? <InstagramAccountSummaryCard latestDay={accountLatestDay} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">投稿一覧</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">
              {lastSyncedAt == null
                ? 'まだデータがありません。「最新化」を押すと取得します。'
                : '表示条件に一致する投稿がありません。期間や種別フィルタを変更してください。'}
            </p>
          ) : (
            <>
              <InstagramMediaTable
                items={items}
                igSort={igSort}
                onSortColumnHidden={resetSortIfHidden}
              />
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-gray-600">
                  {total > 0
                    ? `全${total}件中 ${startItemNumber}-${endItemNumber}件を表示（${igPage}/${totalPages}ページ）`
                    : ''}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={prevHref}
                    prefetch={false}
                    aria-disabled={prevDisabled}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
