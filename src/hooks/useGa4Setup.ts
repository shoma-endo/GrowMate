import { useCallback, useEffect, useState } from 'react';
import type { Ga4ConnectionStatus, Ga4KeyEvent, Ga4PropertySummary } from '@/types/ga4';
import {
  fetchGa4Properties,
  fetchGa4Status,
  fetchGa4KeyEvents,
} from '@/server/actions/ga4Setup.actions';
import { isGa4ReauthError } from '@/domain/errors/ga4-error-handlers';
import { handleAsyncAction } from '@/lib/async-handler';

interface UseGa4SetupResult {
  status: Ga4ConnectionStatus;
  properties: Ga4PropertySummary[];
  keyEvents: Ga4KeyEvent[];
  isSyncingStatus: boolean;
  isLoadingProperties: boolean;
  isLoadingKeyEvents: boolean;
  alertMessage: string | null;
  setStatus: (status: Ga4ConnectionStatus) => void;
  setProperties: (properties: Ga4PropertySummary[]) => void;
  setKeyEvents: (events: Ga4KeyEvent[]) => void;
  setAlertMessage: (message: string | null) => void;
  refreshStatus: () => Promise<void>;
  refetchProperties: () => Promise<void>;
  refetchKeyEvents: (propertyId: string) => Promise<void>;
}

export function useGa4Setup(initialStatus: Ga4ConnectionStatus): UseGa4SetupResult {
  const [status, setStatus] = useState<Ga4ConnectionStatus>(initialStatus);
  const [properties, setProperties] = useState<Ga4PropertySummary[]>([]);
  const [keyEvents, setKeyEvents] = useState<Ga4KeyEvent[]>([]);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [isLoadingKeyEvents, setIsLoadingKeyEvents] = useState(false);

  const refreshStatus = useCallback(async () => {
    await handleAsyncAction(fetchGa4Status, {
      onSuccess: data => setStatus(data as Ga4ConnectionStatus),
      setLoading: setIsSyncingStatus,
      setMessage: setAlertMessage,
      defaultErrorMessage: 'GA4ステータスの取得に失敗しました',
    });
  }, []);

  const refetchProperties = useCallback(async () => {
    await handleAsyncAction(fetchGa4Properties, {
      onSuccess: data => {
        if (Array.isArray(data)) {
          setProperties(data as Ga4PropertySummary[]);
        }
      },
      onError: error => {
        const errorMessage = error.message;
        if (isGa4ReauthError(errorMessage)) {
          refreshStatus();
          setAlertMessage('GA4の認証が期限切れまたは取り消されています。再認証してください。');
        }
      },
      setLoading: setIsLoadingProperties,
      setMessage: setAlertMessage,
      defaultErrorMessage: 'GA4プロパティ一覧の取得に失敗しました',
    });
  }, [refreshStatus]);

  const refetchKeyEvents = useCallback(async (propertyId: string) => {
    if (!propertyId) return;
    await handleAsyncAction(() => fetchGa4KeyEvents(propertyId), {
      onSuccess: data => {
        if (Array.isArray(data)) {
          setKeyEvents(data as Ga4KeyEvent[]);
        }
      },
      onError: error => {
        const errorMessage = error.message;
        if (isGa4ReauthError(errorMessage)) {
          refreshStatus();
          setAlertMessage('GA4の認証が期限切れまたは取り消されています。再認証してください。');
        }
      },
      setLoading: setIsLoadingKeyEvents,
      setMessage: setAlertMessage,
      defaultErrorMessage: 'GA4キーイベント一覧の取得に失敗しました',
    });
  }, [refreshStatus]);

  useEffect(() => {
    if (status.scopeMissing || status.connectionStage === 'unlinked') {
      setProperties([]);
      setKeyEvents([]);
      return;
    }

    refetchProperties();
  }, [status.connectionStage, status.scopeMissing, refetchProperties]);

  return {
    status,
    properties,
    keyEvents,
    isSyncingStatus,
    isLoadingProperties,
    isLoadingKeyEvents,
    alertMessage,
    setStatus,
    setProperties,
    setKeyEvents,
    setAlertMessage,
    refreshStatus,
    refetchProperties,
    refetchKeyEvents,
  };
}
