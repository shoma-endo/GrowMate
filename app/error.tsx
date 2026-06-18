'use client';

import { useEffect } from 'react';
import { RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { isDeploymentMismatchError } from '@/lib/async-handler';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Error boundary caught:', error);
  }, [error]);

  const isDeploymentMismatch = isDeploymentMismatchError(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <TriangleAlert
            className="mb-2 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle>
            {isDeploymentMismatch
              ? '新しいバージョンが公開されました'
              : '申し訳ありません。エラーが発生しました'}
          </CardTitle>
          <CardDescription>
            {isDeploymentMismatch
              ? ERROR_MESSAGES.ERROR_BOUNDARY.DEPLOYMENT_MISMATCH
              : '一時的な問題が発生した可能性があります。お手数ですが、もう一度お試しください。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          {isDeploymentMismatch ? (
            <Button onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" />
              再読み込み
            </Button>
          ) : (
            <Button onClick={() => reset()}>
              <RotateCcw aria-hidden="true" />
              再試行
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
