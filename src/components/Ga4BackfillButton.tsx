'use client';

import { History, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { GA4_EVALUATION_DEFAULT_DAYS } from '@/lib/ga4-evaluation-period';

interface Ga4BackfillResponse {
  success: boolean;
  error?: string;
  data?:
    | { alreadySynced: true }
    | {
        startDate: string;
        endDate: string;
        upserted: number;
        isPartial?: boolean;
        isSampled?: boolean;
      };
}

interface Ga4BackfillButtonProps {
  disabled?: boolean;
  size?: 'sm' | 'default';
  /** 取込が成功したあとに呼ばれる。表示中の集計を取り直すために使う */
  onCompleted?: () => void | Promise<void>;
}

/**
 * 評価入力の期間上限（既定90日）ぶんを GA4 から取り込み直す。
 *
 * 日次同期は前回取込日以降しか取得しないため、取込項目を追加したあとの既存行は
 * この導線でしか埋まらない（仕様書 §4.1.2 / AC-18）。指標の欠けに気づくのは
 * ダッシュボードなので、操作もそこに置く。
 */
export function Ga4BackfillButton({
  disabled = false,
  size = 'sm',
  onCompleted,
}: Ga4BackfillButtonProps) {
  const [isRunning, setIsRunning] = useState(false);

  const handleClick = async () => {
    setIsRunning(true);
    try {
      const response = await fetch('/api/ga4/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backfillDays: GA4_EVALUATION_DEFAULT_DAYS }),
      });

      const json = (await response.json().catch(() => null)) as Ga4BackfillResponse | null;

      if (!response.ok || !json?.success) {
        throw new Error(json?.error || `GA4の再取込に失敗しました (HTTP ${response.status})`);
      }

      const data = json.data;
      if (!data || 'alreadySynced' in data) {
        toast.info('取り込む期間がありませんでした');
        return;
      }

      toast.success(
        `過去${GA4_EVALUATION_DEFAULT_DAYS}日を取り込み直しました（${data.startDate} 〜 ${data.endDate}、${data.upserted}件）`
      );
      // 打ち切り・サンプリングは数値の欠損につながるため、成功扱いのまま黙らせない
      if (data.isPartial) {
        toast.warning(
          'GA4の取得件数が上限に達したため、一部の行が取り込めていません。期間を分けて再実行してください'
        );
      }
      if (data.isSampled) {
        toast.warning('GA4がサンプリングされたデータを返しました。数値は概算値です');
      }

      await onCompleted?.();
    } catch (error) {
      console.error('[Ga4BackfillButton] backfill failed', error);
      toast.error(error instanceof Error ? error.message : 'GA4の再取込に失敗しました');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={handleClick}
      disabled={disabled || isRunning}
      className="flex items-center gap-2"
    >
      {isRunning ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <History className="h-4 w-4" />
      )}
      {isRunning ? '再取込中...' : `過去${GA4_EVALUATION_DEFAULT_DAYS}日を再取込`}
    </Button>
  );
}
