'use client';

import React from 'react';
import { useLiffContext } from '@/components/LiffProvider';
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
  const { isLoggedIn, getAccessToken, isLoading: liffLoading, user } = useLiffContext();
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
  const initialSessionLoadedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    // isLoggedIn: LINE ユーザー / !!user: Email ユーザー（LIFF 未ログインだが Supabase セッションあり）
    if ((isLoggedIn || !!user) && !liffLoading) {
      Promise.resolve(chatSession.actions.loadSessions ? chatSession.actions.loadSessions() : undefined)
        .then(async () => {
          const trimmedSessionId = initialSessionId?.trim();
          if (
            trimmedSessionId &&
            initialSessionLoadedRef.current !== trimmedSessionId &&
            chatSession.actions.loadSession
          ) {
            try {
              await chatSession.actions.loadSession(trimmedSessionId);
              initialSessionLoadedRef.current = trimmedSessionId;
            } catch (error) {
              console.error('初期チャットセッションの読み込みに失敗しました:', error);
            }
          }
        })
        .catch(error => {
          console.error('❌ 初期化エラー:', error);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, liffLoading, initialSessionId, user]); // ✅ Email ユーザー対応: user がセットされたタイミングでも初期化

  // LIFF初期化中はLiffProviderが表示を担当するため、ここでは何も表示しない
  if (liffLoading) {
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
