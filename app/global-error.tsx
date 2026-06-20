'use client';

import { useEffect } from 'react';

import { isDeploymentMismatchError } from '@/lib/async-handler';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error occurred:', error);
  }, [error]);

  const isDeploymentMismatch = isDeploymentMismatchError(error);

  return (
    <html>
      <body style={{ padding: 24 }}>
        {isDeploymentMismatch ? (
          <>
            <h2>新しいバージョンが公開されました</h2>
            <p>{ERROR_MESSAGES.ERROR_BOUNDARY.DEPLOYMENT_MISMATCH}</p>
            <button type="button" onClick={() => window.location.reload()}>
              再読み込み
            </button>
          </>
        ) : (
          <>
            <h2>申し訳ありません。エラーが発生しました。</h2>
            <p>{error?.message}</p>
            <button type="button" onClick={() => reset()}>
              再試行
            </button>
          </>
        )}
      </body>
    </html>
  );
}
