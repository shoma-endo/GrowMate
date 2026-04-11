'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage, ChatSession, IChatService } from '@/domain/interfaces/IChatService';
import {
  ChatState,
  initialChatState,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
} from '@/domain/models/chatModels';
import { ChatError } from '@/domain/errors/ChatError';
import type { ChatSessionActions, ChatSessionHook } from '@/types/hooks';
import { getResponseModelForBlogCreation } from '@/lib/canvas-content';
import {
  ERROR_MESSAGES as CHAT_ERROR_MESSAGES,
  CHAT_HISTORY_LIMIT,
  STEP7_FULL_BODY_TRIGGER,
} from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { replaceToEmailLinkConflictLogin } from '@/lib/auth/emailLinkConflictClient';

export type { ChatSessionActions, ChatSessionHook };

const MAX_MESSAGES = CHAT_HISTORY_LIMIT;
const STEP7_RECENT_MESSAGE_LIMIT = 2;

interface SerializableMessage {
  role: 'user' | 'assistant';
  content: string;
}

const createRequestMessages = (
  messages: ChatMessage[],
  options?: { limit?: number }
): SerializableMessage[] => {
  const limit = options?.limit ?? MAX_MESSAGES;
  return messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .slice(-limit)
    .map(({ role, content }) => ({ role, content }));
};

const createSessionPreview = (content: string, sessionId: string): ChatSession => ({
  id: sessionId,
  title: content.length > 30 ? `${content.slice(0, 30)}...` : content,
  updatedAt: new Date(),
  messageCount: 1,
  lastMessage: content,
});

const createStreamingMessagePair = (content: string, model: string) => {
  const responseModel = getResponseModelForBlogCreation(model);
  return {
    userMessage: createUserMessage(content, model),
    assistantMessage: createAssistantMessage('', responseModel),
  };
};

interface StreamingParams {
  content: string;
  model: string;
  accessToken: string;
  currentSessionId: string;
  recentMessages: SerializableMessage[];
  systemPrompt?: string;
  serviceId?: string;
  /** 本文生成ボタン用: blog_creation_step7 の応答を session_combined_contents に保存 */
  step7FullBodyGeneration?: boolean;
}

export const useChatSession = (
  chatService: IChatService,
  getAccessToken: () => Promise<string>
): ChatSessionHook => {
  const [state, setState] = useState<ChatState>(initialChatState);
  // loadSession() の最新リクエストを追跡（古いレスポンスで state が上書きされるのを防ぐ）
  const loadSessionRequestRef = useRef(0);

  const loadSessions = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null, warning: null }));
      const sessions = await chatService.loadSessions();
      setState(prev => ({ ...prev, sessions, isLoading: false }));
    } catch (error) {
      console.error('Load sessions error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'セッション一覧の読み込みに失敗しました';
      setState(prev => ({ ...prev, error: errorMessage, isLoading: false, warning: null }));
    }
  }, [chatService]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      const requestId = ++loadSessionRequestRef.current;
      setState(prev => ({ ...prev, isLoading: true, error: null, warning: null }));

      try {
        const messages = await chatService.loadSessionMessages(sessionId);
        // 新しいリクエストが来ていた場合は古い結果を捨てる（並行実行時の上書き防止）
        if (requestId !== loadSessionRequestRef.current) return;
        setState(prev => ({
          ...prev,
          messages,
          currentSessionId: sessionId,
          isLoading: false,
        }));
      } catch (error) {
        if (requestId !== loadSessionRequestRef.current) return;
        console.error('Load session error:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'セッションの読み込みに失敗しました';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
          warning: null,
        }));
      }
    },
    [chatService]
  );

  const handleStreamingMessage = useCallback(
    async ({
      content,
      model,
      accessToken,
      currentSessionId,
      recentMessages,
      systemPrompt,
      serviceId,
      step7FullBodyGeneration,
    }: StreamingParams) => {
      // step7FullBodyGeneration: 楽観的表示は短いトリガーを使い、loadSession 後の表示と一致させる
      const displayContent =
        step7FullBodyGeneration && model === 'blog_creation_step7'
          ? STEP7_FULL_BODY_TRIGGER
          : content;
      const { userMessage, assistantMessage } = createStreamingMessagePair(
        displayContent,
        model
      );

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantMessage],
        error: null,
        warning: null,
      }));

      try {
        const response = await fetch('/api/chat/anthropic/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            sessionId: currentSessionId || undefined,
            messages: recentMessages.map(msg => ({
              role: msg.role,
              content: msg.content,
            })),
            userMessage: content,
            model,
            ...(systemPrompt ? { systemPrompt } : {}),
            ...(serviceId ? { serviceId } : {}),
            ...(step7FullBodyGeneration ? { step7FullBodyGeneration: true } : {}),
          }),
        });

        if (response.status === 429) {
          const bodyText = await response.text().catch(() => '');
          const warningMessage = extractWarningMessage(bodyText);

          setState(prev => {
            const updatedMessages =
              prev.messages.length > 0 &&
              prev.messages[prev.messages.length - 1]?.role === 'assistant'
                ? prev.messages.slice(0, -1)
                : prev.messages;

            return {
              ...prev,
              messages: updatedMessages,
              warning: warningMessage,
              error: null,
              isLoading: false,
            };
          });

          return false;
        }

        if (response.status === 409) {
          setState(prev => {
            const msgs = prev.messages;
            const last = msgs[msgs.length - 1];
            const second = msgs[msgs.length - 2];
            if (
              msgs.length >= 2 &&
              second?.role === 'user' &&
              last?.role === 'assistant'
            ) {
              return {
                ...prev,
                messages: msgs.slice(0, -2),
                isLoading: false,
                error: null,
                warning: null,
              };
            }
            return { ...prev, isLoading: false, error: null, warning: null };
          });
          replaceToEmailLinkConflictLogin();
          return false;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response stream');
        }

        let accumulatedText = '';
        let idleTimeout: ReturnType<typeof setTimeout> | null = null;
        let sseBuffer = '';
        let streamSucceeded = false;

        const resetIdleTimeout = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          idleTimeout = setTimeout(() => {
            console.warn('Stream idle timeout');
            reader.cancel();
          }, 120000); // 2分のタイムアウト
        };

        resetIdleTimeout();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            resetIdleTimeout();

            const chunkText = new TextDecoder().decode(value);
            sseBuffer += chunkText;

            // SSEイベントは空行で区切られる
            const events = sseBuffer.split('\n\n');
            sseBuffer = events.pop() || '';

            for (const eventBlock of events) {
              if (!eventBlock.trim()) continue;
              const lines = eventBlock.split('\n');
              const eventType = lines
                .find(l => l.startsWith('event: '))
                ?.slice(7)
                ?.trim();
              if (!eventType) continue;

              // 複数 data: 行を結合
              const dataCombined = lines
                .filter(l => l.startsWith('data: '))
                .map(l => l.slice(6))
                .join('\n');

              try {
                if (eventType === 'chunk') {
                  const data = JSON.parse(dataCombined);
                  accumulatedText += data; // サーバーはJSON文字列を送る
                  setState(prev => ({
                    ...prev,
                    messages: prev.messages.map((msg, idx) =>
                      idx === prev.messages.length - 1 ? { ...msg, content: accumulatedText } : msg
                    ),
                  }));
                } else if (eventType === 'final') {
                  streamSucceeded = true;
                  const data = JSON.parse(dataCombined);
                  const responseModel = getResponseModelForBlogCreation(model);
                  setState(prev => ({
                    ...prev,
                    currentSessionId: data.sessionId || prev.currentSessionId,
                    messages: prev.messages.map((msg, idx) =>
                      idx === prev.messages.length - 1
                        ? { ...msg, content: data.message, model: responseModel }
                        : msg
                    ),
                    isLoading: false,
                  }));

                  if (!currentSessionId && data.sessionId) {
                    const newSession = createSessionPreview(content, data.sessionId);
                    setState(prev => ({
                      ...prev,
                      sessions: [newSession, ...prev.sessions],
                    }));
                  }
                } else if (eventType === 'error') {
                  const data = JSON.parse(dataCombined);
                  setState(prev => ({
                    ...prev,
                    isLoading: false,
                    error: data.message || 'ストリーミングエラー',
                    warning: null,
                  }));
                  return false;
                } else if (eventType === 'usage' || eventType === 'meta') {
                  try {
                    JSON.parse(dataCombined);
                  } catch (error) {
                    console.warn('[Stream] Failed to parse JSON:', error);
                  }
                } else if (eventType === 'done') {
                  // 明示終了
                  setState(prev => ({
                    ...prev,
                    isLoading: false,
                  }));
                  return streamSucceeded;
                }
              } catch (e) {
                console.warn('Failed to parse SSE event:', eventType, e);
              }
            }
          }
        } finally {
          if (idleTimeout) clearTimeout(idleTimeout);
          reader.releaseLock();
        }

        return streamSucceeded;
      } catch (error) {
        console.error('Streaming error:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'ストリーミングに失敗しました',
          warning: null,
        }));
        return false;
      }
    },
    []
  );

  const sendMessage = useCallback(
    async (
      content: string,
      model: string,
      options?: {
        systemPrompt?: string;
        serviceId?: string;
        step7FullBodyGeneration?: boolean;
        /** true のとき過去のチャット履歴を送信しない */
        skipHistory?: boolean;
        sessionIdOverride?: string;
      }
    ) => {
      setState(prev => ({ ...prev, isLoading: true, error: null, warning: null }));

      try {
        const accessToken = await getAccessToken();
        const resolvedSessionId =
          options?.sessionIdOverride?.trim() || state.currentSessionId || '';
        const streamingParams: StreamingParams = {
          content,
          model,
          accessToken,
          currentSessionId: resolvedSessionId,
          recentMessages: options?.skipHistory
            ? []
            : createRequestMessages(state.messages, {
                limit:
                  options?.step7FullBodyGeneration && model === 'blog_creation_step7'
                    ? STEP7_RECENT_MESSAGE_LIMIT
                    : MAX_MESSAGES,
              }),
        };

        if (options?.systemPrompt) {
          streamingParams.systemPrompt = options.systemPrompt;
        }

        if (options?.serviceId) {
          streamingParams.serviceId = options.serviceId;
        }

        if (options?.step7FullBodyGeneration) {
          streamingParams.step7FullBodyGeneration = true;
        }

        const success = await handleStreamingMessage(streamingParams);
        return success;
      } catch (error) {
        console.error('Send message error:', error);
        const errorMessage =
          error instanceof ChatError
            ? error.userMessage
            : error instanceof Error
              ? error.message
              : '送信に失敗しました';

        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
          warning: null,
        }));
        return false;
      }
    },
    [state.currentSessionId, state.messages, getAccessToken, handleStreamingMessage]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await chatService.deleteSession(sessionId);
        setState(prev => ({
          ...prev,
          sessions: prev.sessions.filter(s => s.id !== sessionId),
          // 削除されたセッションが現在のセッションの場合、新しいチャットを開始
          ...(prev.currentSessionId === sessionId
            ? {
                currentSessionId: '',
                messages: [],
              }
            : {}),
        }));
      } catch (error) {
        console.error('Delete session error:', error);
        const errorMessage =
          error instanceof Error ? error.message : ERROR_MESSAGES.CHAT.SESSION_DELETE_FAILED;
        setState(prev => ({ ...prev, error: errorMessage, warning: null }));
      }
    },
    [chatService]
  );

  const searchSessions = useCallback(
    async (query: string, options?: { limit?: number }) => {
      const trimmed = query.trim();

      if (trimmed === '') {
        setState(prev => ({
          ...prev,
          searchQuery: '',
          searchResults: [],
          searchError: null,
          isSearching: false,
        }));
        return;
      }

      setState(prev => ({
        ...prev,
        searchQuery: trimmed,
        isSearching: true,
        searchError: null,
      }));

      try {
        const results = await chatService.searchSessions(trimmed, options);
        setState(prev => ({
          ...prev,
          searchQuery: trimmed,
          searchResults: results,
          isSearching: false,
          searchError: null,
        }));
      } catch (error) {
        console.error('Search sessions error:', error);
        const errorMessage =
          error instanceof ChatError
            ? error.userMessage
            : error instanceof Error
              ? error.message
              : 'チャットの検索に失敗しました';

        setState(prev => ({
          ...prev,
          searchQuery: trimmed,
          searchResults: [],
          isSearching: false,
          searchError: errorMessage,
        }));
      }
    },
    [chatService]
  );

  const clearSearch = useCallback(() => {
    setState(prev => ({
      ...prev,
      searchQuery: '',
      searchResults: [],
      searchError: null,
      isSearching: false,
    }));
  }, []);

  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      try {
        await chatService.updateSessionTitle(sessionId, title);
        setState(prev => ({
          ...prev,
          sessions: prev.sessions.map(session =>
            session.id === sessionId ? { ...session, title } : session
          ),
        }));
      } catch (error) {
        console.error('Update session title error:', error);
        if (error instanceof ChatError) {
          throw error;
        }
        throw new Error(
          error instanceof Error ? error.message : ERROR_MESSAGES.CHAT.SESSION_TITLE_UPDATE_FAILED
        );
      }
    },
    [chatService]
  );

  const updateSessionServiceId = useCallback(
    async (sessionId: string, serviceId: string) => {
      try {
        await chatService.updateSessionServiceId(sessionId, serviceId);
      } catch (error) {
        console.error('Update session service ID error:', error);
        if (error instanceof ChatError) {
          throw error;
        }
        throw new Error(
          error instanceof Error ? error.message : 'セッションのサービス更新に失敗しました'
        );
      }
    },
    [chatService]
  );

  const startNewSession = useCallback(() => {
    setState(prev => ({
      ...prev,
      currentSessionId: '',
      messages: [],
      error: null,
      warning: null,
    }));
  }, []);

  const setError = useCallback((message: string | null) => {
    setState(prev => ({
      ...prev,
      error: message,
      warning: null,
      isLoading: false,
    }));
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, createSystemMessage(content)],
    }));
  }, []);

  const actions: ChatSessionActions = {
    sendMessage,
    setError,
    addSystemMessage,
    loadSessions,
    loadSession,
    deleteSession,
    updateSessionTitle,
    updateSessionServiceId,
    searchSessions,
    clearSearch,
    startNewSession,
  };

  return {
    state,
    actions,
  };
};

function extractWarningMessage(rawBody: string): string {
  if (!rawBody) {
    return CHAT_ERROR_MESSAGES.daily_chat_limit;
  }

  const dataMatch = rawBody.match(/data:\s*(\{.*\})/);
  if (dataMatch) {
    const payload = dataMatch[1];
    if (!payload) {
      return CHAT_ERROR_MESSAGES.daily_chat_limit;
    }
    try {
      const parsed = JSON.parse(payload) as { message?: unknown };
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        return parsed.message;
      }
    } catch {
      // no-op fall back to default
    }
  }

  return CHAT_ERROR_MESSAGES.daily_chat_limit;
}
