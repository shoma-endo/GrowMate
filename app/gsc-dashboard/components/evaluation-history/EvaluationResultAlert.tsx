'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDateTime } from '@/lib/date-utils';

interface EvaluationResultAlertProps {
  variant: 'error' | 'no_metrics';
  errorCode?: 'import_failed' | 'no_metrics' | null | undefined;
  errorMessage?: string | null | undefined;
  createdAt: string;
}

export function EvaluationResultAlert({
  variant,
  errorCode,
  errorMessage,
  createdAt,
}: EvaluationResultAlertProps) {
  const isError = variant === 'error';

  return (
    <Alert variant={isError ? 'destructive' : 'default'}>
      <div className="flex gap-3">
        <AlertCircle
          className={`h-5 w-5 mt-0.5 flex-shrink-0 ${isError ? 'text-red-600' : 'text-gray-500'}`}
        />
        <div className="flex-1 space-y-3">
          <AlertTitle
            className={`${isError ? 'text-red-900' : 'text-gray-900'} font-semibold text-base`}
          >
            {isError ? '評価実行エラー' : 'データ未取得'}
          </AlertTitle>
          <AlertDescription className={`${isError ? 'text-red-800' : 'text-gray-700'} space-y-2`}>
            {isError ? (
              <p className="text-sm">
                <span className="font-medium">エラー種別: </span>
                {errorCode === 'import_failed' ? 'GSCデータ取得失敗' : 'メトリクスデータなし'}
              </p>
            ) : (
              <p className="text-sm">
                <span className="font-medium">理由: </span>
                Google Search Console に該当ページの指標がまだありません。
              </p>
            )}
            {errorMessage?.trim() && (
              <p className="text-sm">
                <span className="font-medium">詳細: </span>
                {errorMessage}
              </p>
            )}
            <p className="text-sm">
              <span className="font-medium">発生日時: </span>
              {formatDateTime(createdAt)}
            </p>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
