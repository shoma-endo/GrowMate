'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { setGa4EvaluationEnabled } from '@/server/actions/adminGa4Evaluation.actions';
import { formatDateTimeWithSeconds } from '@/lib/date-utils';

type Props = {
  initialEnabled: boolean;
  initialUpdatedAt: string | null;
  initialError?: string | null;
};

export default function Ga4EvaluationSettingsClient({
  initialEnabled,
  initialUpdatedAt,
  initialError,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const next = !enabled;
    startTransition(async () => {
      const result = await setGa4EvaluationEnabled({ enabled: next });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEnabled(next);
      setUpdatedAt(new Date().toISOString());
      toast.success(next ? 'GA4コンテンツ評価を有効にしました' : 'GA4コンテンツ評価を無効にしました');
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">GA4コンテンツ評価の設定</h1>
      </div>

      {initialError ? (
        <Alert variant="destructive">
          <AlertDescription>{initialError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span>GA4コンテンツ評価</span>
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
              }`}
            >
              {enabled ? '有効' : '無効'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            記事ごとのコンテンツ力スコアの算出と、AIによる講評の生成をまとめて停止・再開します。
            無効にすると記事詳細の評価ボタンが非表示になり、実行中でない評価は開始できなくなります。
            すでに保存済みの評価結果とメディア全体スコアは表示されたままです。
          </p>
          <p className="text-sm text-gray-600">
            外部APIやAIの障害でおかしな結果が出たときは、ここを無効にすればデプロイなしで止められます。
          </p>

          {updatedAt ? (
            <p className="text-xs text-gray-500">
              最終更新: {formatDateTimeWithSeconds(updatedAt)}
            </p>
          ) : null}

          <Button
            onClick={handleToggle}
            disabled={isPending}
            variant={enabled ? 'destructive' : 'default'}
            aria-label={enabled ? 'GA4コンテンツ評価を無効にする' : 'GA4コンテンツ評価を有効にする'}
          >
            {isPending ? '更新中...' : enabled ? '無効にする' : '有効にする'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
