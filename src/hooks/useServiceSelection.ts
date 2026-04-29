'use client';

import { useState, useEffect, useCallback } from 'react';
import { getBrief } from '@/server/actions/brief.actions';
import {
  getSessionServiceIdSA,
  updateSessionServiceIdSA,
} from '@/server/actions/chat.actions';
import type { Service } from '@/server/schemas/brief.schema';

/**
 * サービス選択の状態
 */
interface ServiceSelectionState {
  /** サービス一覧 */
  services: Service[];
  /** 選択中のサービスID */
  selectedServiceId: string | null;
  /** サービス一覧を取得中かどうか */
  isServicesLoading: boolean;
  /** サービスIDを取得中かどうか */
  isServiceIdLoading: boolean;
  /** サービス取得エラーメッセージ */
  servicesError: string | null;
}

/**
 * サービス選択のアクション
 */
interface ServiceSelectionActions {
  /** サービスを変更（既存セッションの場合はDBも更新） */
  changeService: (serviceId: string) => Promise<void>;
  /** サービス取得エラーを閉じる */
  dismissServicesError: () => void;
}

/**
 * useServiceSelection フックの戻り値
 */
interface ServiceSelectionHook {
  state: ServiceSelectionState;
  actions: ServiceSelectionActions;
}

/**
 * useServiceSelection フックのオプション
 */
interface UseServiceSelectionOptions {
  /** 現在のセッションID（null の場合は新規チャット） */
  currentSessionId: string | null;
}

/**
 * サービス選択ロジックを管理するカスタムフック
 *
 * @description
 * - 事業者情報からサービス一覧を取得
 * - セッション切り替え時に適切なサービスIDを設定
 * - サービス変更時にDBへの永続化を実行
 */
export function useServiceSelection({
  currentSessionId,
}: UseServiceSelectionOptions): ServiceSelectionHook {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [isServicesLoading, setIsServicesLoading] = useState(true);
  const [isServiceIdLoading, setIsServiceIdLoading] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);

  // 事業者情報（サービス一覧）の取得
  useEffect(() => {
    let isActive = true;
    setIsServicesLoading(true);
    setServicesError(null);

    const loadBrief = async () => {
      try {
        const res = await getBrief();
        if (isActive && res.success && res.data) {
          setServices(res.data.services || []);
          setServicesError(null);
        } else if (isActive && !res.success) {
          console.error('事業者情報の取得に失敗しました:', res.error);
          setServicesError('事業者情報の取得に失敗しました。画面を更新してください。');
        }
      } catch (error) {
        if (isActive) {
          console.error('事業者情報の取得エラー:', error);
          setServicesError('事業者情報の取得中にエラーが発生しました。');
        }
      } finally {
        if (isActive) {
          setIsServicesLoading(false);
        }
      }
    };

    loadBrief();

    return () => {
      isActive = false;
    };
  }, []);

  // セッション切替時にサービスIDを取得
  useEffect(() => {
    // サービス一覧の取得が完了するまで待機
    if (isServicesLoading) {
      return;
    }

    let isActive = true;
    setIsServiceIdLoading(true);

    const fetchSessionServiceId = async () => {
      if (!currentSessionId) {
        // 新規チャットの場合は最初のサービスを選択
        if (services.length > 0 && services[0]) {
          setSelectedServiceId(services[0].id);
        } else {
          setSelectedServiceId(null);
        }
        setIsServiceIdLoading(false);
        return;
      }

      try {
        const result = await getSessionServiceIdSA(currentSessionId);
        if (!isActive) {
          return;
        }
        if (result.success && result.data) {
          setSelectedServiceId(result.data);
        } else if (services.length > 0 && services[0]) {
          // サービスIDが未設定の場合は最初のサービスを選択
          setSelectedServiceId(services[0].id);
        } else {
          setSelectedServiceId(null);
        }
      } catch (error) {
        console.error('Failed to fetch session service ID:', error);
        // エラー時も最初のサービスにフォールバック
        if (isActive && services.length > 0 && services[0]) {
          setSelectedServiceId(services[0].id);
        }
      } finally {
        if (isActive) {
          setIsServiceIdLoading(false);
        }
      }
    };

    fetchSessionServiceId();

    return () => {
      isActive = false;
    };
  }, [currentSessionId, services, isServicesLoading]);

  // サービス変更時の処理（既存セッションの場合はDBも更新）
  const changeService = useCallback(
    async (serviceId: string) => {
      setSelectedServiceId(serviceId);

      // 既存セッションの場合はDBを更新
      if (currentSessionId) {
        try {
          await updateSessionServiceIdSA(currentSessionId, serviceId);
        } catch (error) {
          console.error('Failed to update session service ID:', error);
        }
      }
    },
    [currentSessionId]
  );

  // エラーを閉じる
  const dismissServicesError = useCallback(() => {
    setServicesError(null);
  }, []);

  return {
    state: {
      services,
      selectedServiceId,
      isServicesLoading,
      isServiceIdLoading,
      servicesError,
    },
    actions: {
      changeService,
      dismissServicesError,
    },
  };
}
