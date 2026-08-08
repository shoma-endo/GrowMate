'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatCount } from '@/lib/instagram-format';
import type { InstagramAccountInsightsDailyRow } from '@/types/instagram';

interface InstagramAccountSummaryCardProps {
  latestDay: InstagramAccountInsightsDailyRow;
}

/** ツールバーカード内に統合表示するアカウント指標（リーチ・フォロワー数）の1行サマリー */
export default function InstagramAccountSummaryCard({
  latestDay,
}: InstagramAccountSummaryCardProps) {
  const followerLabel =
    latestDay.followerCount == null ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-gray-500 underline decoration-dotted">対象外</span>
          </TooltipTrigger>
          <TooltipContent>
            フォロワー100人未満のアカウントではこの指標は提供されません
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      formatCount(latestDay.followerCount)
    );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-3 pb-3 border-b text-sm">
      <span className="text-gray-500">アカウント指標（最新日: {latestDay.date}）</span>
      <span>
        リーチ <strong className="font-semibold">{formatCount(latestDay.reach)}</strong>
      </span>
      <span>
        フォロワー数 <strong className="font-semibold">{followerLabel}</strong>
      </span>
    </div>
  );
}
