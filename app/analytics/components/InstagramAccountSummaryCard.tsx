'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export default function InstagramAccountSummaryCard({
  latestDay,
}: InstagramAccountSummaryCardProps) {
  const followerLabel =
    latestDay.followerCount == null ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-gray-500">対象外</span>
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          アカウント指標（最新日: {latestDay.date}）
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">リーチ（最新日）</p>
            <p className="text-lg font-semibold">{formatCount(latestDay.reach)}</p>
          </div>
          <div>
            <p className="text-gray-500">フォロワー数（最新日）</p>
            <p className="text-lg font-semibold">{followerLabel}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          DB には直近30日分を保持しています。表示は最新同期日の値です。
        </p>
      </CardContent>
    </Card>
  );
}
