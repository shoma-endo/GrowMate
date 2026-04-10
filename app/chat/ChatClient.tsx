'use client';

import React from 'react';
import { useAuth } from '@/components/AuthProvider';
import { ChatService } from '@/domain/services/chatService';
import { useChatSession } from '@/hooks/useChatSession';
import { useMobile } from '@/hooks/useMobile';
import { ChatLayout } from './components/ChatLayout';
import ErrorBoundary from './components/common/ErrorBoundary';
import type { BlogStepId } from '@/lib/constants';

/**
 * ChatClient - Dependency Injection Container & Root State Provider
 *
 * 責任:
 * 1. DIコンテナからサービスを注入
 * 2. 全てのフックを初期化
 * 3. ChatLayoutに状態を提供
 *
 */
interface ChatClientProps {
  initialSessionId?: string | undefined;
  initialStep?: BlogStepId | undefined;
}

const ChatClient: React.FC<ChatClientProps> = ({ initialSessionId, initialStep }) => {
  const { isLoggedIn, getAccessToken, isLoading: authLoading, user } = useAuth();
  const { isMobile } = useMobile();

  const chatService = React.useMemo(() => new ChatService(), []);

  // ✅ サービスにaccessTokenProviderを設定（getAccessTokenが変わっても再作成されない）
  React.useEffect(() => {
    // chatServiceにsetAccessTokenProviderメソッドがあるかチェック
    if (
      chatService &&
      'setAccessTokenProvider' in chatService &&
      typeof chatService.setAccessTokenProvider === 'function'
    ) {
      chatService.setAccessTokenProvider(getAccessToken);
    }
  }, [chatService, getAccessToken]);

  // 各機能のフックを初期化
  const chatSession = useChatSession(chatService, getAccessToken);

  // ✅ 初期マウント時（画面遷移時）のみ初期化（1回のみ実行保証）
  const sessionsLoadedRef = React.useRef(false);
  // Effect 2 による「読込済み」管理（Effect 2 のみが更新する）
  const initialSessionLoadedRef = React.useRef<string | null>(null);
  // Effect 1 の doLoad が処理中のセッション ID（レース条件防止用、Effect 1 のみが更新する）
  const loadingSessionIdRef = React.useRef<string | null>(null);

  // セッション一覧 + 初期セッションの読み込み（認証確定後1回のみ）
  React.useEffect(() => {
    // isLoggedIn: 従来の LINE Cookie 経路 / !!user: Email セッション確定後
    if (!(isLoggedIn || !!user) || authLoading) return;
    // loadSessions は認証確定後1回のみ実行（LINE ユーザーで user が後からセットされても二重実行しない）
    if (sessionsLoadedRef.current) return;
    sessionsLoadedRef.current = true;

    const trimmedSessionId = initialSessionId?.trim();
    // Effect 2 の二重起動を防止するため「今から読み込む ID」を同期的にマーク
    loadingSessionIdRef.current = trimmedSessionId ?? null;

    const doLoad = async () => {
      await chatSession.actions.loadSessions?.();
      // loadSessions() 完了後に Effect 2 が別 ID を読み込んでいた場合はスキップ（レース条件防止）
      if (trimmedSessionId && loadingSessionIdRef.current === trimmedSessionId) {
        await chatSession.actions.loadSession?.(trimmedSessionId);
        initialSessionLoadedRef.current = trimmedSessionId; // 呼び出し完了後に読込済みマーク
      }
      loadingSessionIdRef.current = null; // doLoad 完了後にクリア
    };
    doLoad().catch(error => console.error('❌ 初期化エラー:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, authLoading, user]); // ✅ Email ユーザー対応: user がセットされたタイミングでも初期化

  // initialSessionId 変更時に特定セッションを読み込む（セッション一覧ロード後のみ）
  React.useEffect(() => {
    if (!(isLoggedIn || !!user) || authLoading) return;
    if (!sessionsLoadedRef.current) return; // セッション一覧未ロード時はスキップ
    const trimmedSessionId = initialSessionId?.trim();
    if (!trimmedSessionId) return;
    // Effect 1 が現在この ID を処理中なら二重起動をスキップ
    if (loadingSessionIdRef.current === trimmedSessionId) return;
    // 既に読込済みの ID はスキップ
    if (initialSessionLoadedRef.current === trimmedSessionId) return;

    // Effect 1 の doLoad が別 ID を読む前にキャンセルされるよう loadingRef をクリア
    loadingSessionIdRef.current = null;
    const loadAndMark = async () => {
      await chatSession.actions.loadSession?.(trimmedSessionId);
      initialSessionLoadedRef.current = trimmedSessionId; // 呼び出し完了後に読込済みマーク
    };
    loadAndMark().catch(error => console.error('初期チャットセッションの読み込みに失敗しました:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId, isLoggedIn, authLoading, user]);

  // 認証状態読み込み中は AuthProvider がローディング UI を担当するため、ここでは何も表示しない
  if (authLoading) {
    return null;
  }

  return (
    <ErrorBoundary>
      <ChatLayout
        chatSession={chatSession}
        isMobile={isMobile}
        initialStep={initialStep ?? null}
      />
    </ErrorBoundary>
  );
};

export default ChatClient;
