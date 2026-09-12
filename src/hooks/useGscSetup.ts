import { useCallback, useEffect, useState } from 'react';
import type { GscConnectionStatus, GscSiteEntry } from '@/types/gsc';
import { fetchGscProperties, fetchGscStatus } from '@/server/actions/gscSetup.actions';
import { isGoogleOAuthReauthError } from '@/domain/errors/google-oauth-error-handlers';
import { handleAsyncAction } from '@/lib/async-handler';

interface UseGscSetupResult {
  status: GscConnectionStatus;
  properties: GscSiteEntry[];
  isSyncingStatus: boolean;
  isLoadingProperties: boolean;
  alertMessage: string | null;
  setStatus: (status: GscConnectionStatus) => void;
  setProperties: (properties: GscSiteEntry[]) => void;
  setAlertMessage: (message: string | null) => void;
  refreshStatus: () => Promise<void>;
  refetchProperties: () => Promise<void>;
}

/**
 * Google Search Console セットアップのロジックを管理する Custom Hook
 *
 * @param initialStatus - 初期接続ステータス
 */
export function useGscSetup(initialStatus: GscConnectionStatus): UseGscSetupResult {
  const [status, setStatus] = useState<GscConnectionStatus>(initialStatus);
  const [properties, setProperties] = useState<GscSiteEntry[]>([]);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);

  const refreshStatus = useCallback(async () => {
    await handleAsyncAction(fetchGscStatus, {
      onSuccess: data => setStatus(data as GscConnectionStatus),
      setLoading: setIsSyncingStatus,
      setMessage: setAlertMessage,
      defaultErrorMessage: 'ステータスの取得に失敗しました',
    });
  }, []);

  const refetchProperties = useCallback(async () => {
    if (!status.connected) return;

    await handleAsyncAction(fetchGscProperties, {
      onSuccess: data => {
        if (Array.isArray(data)) {
          setProperties(data as GscSiteEntry[]);
        }
      },
      onError: error => {
        const errorMessage = error.message;
        // トークン期限切れ/取り消しエラーの場合は再認証を促す
        if (isGoogleOAuthReauthError(errorMessage)) {
          // ステータスを再取得して needsReauth を更新
          refreshStatus();
          setAlertMessage(
            'Googleアカウントの認証が期限切れまたは取り消されています。再認証してください。'
          );
        }
      },
      setLoading: setIsLoadingProperties,
      setMessage: setAlertMessage,
      defaultErrorMessage: 'プロパティ一覧の取得に失敗しました',
    });
  }, [status.connected, refreshStatus]);

  useEffect(() => {
    if (status.connected) {
      refetchProperties();
    } else {
      setProperties([]);
    }
  }, [status.connected, refetchProperties]);

  return {
    status,
    properties,
    isSyncingStatus,
    isLoadingProperties,
    alertMessage,
    setStatus,
    setProperties,
    setAlertMessage,
    refreshStatus,
    refetchProperties,
  };
}
