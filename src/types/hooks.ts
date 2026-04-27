/**
 * フック専用の型定義
 */
import type { ChatState } from '../domain/models/chatModels';

/**
 * モバイル検出フック関連
 */
export interface UseMobileResult {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  screenWidth: number;
  orientation: 'portrait' | 'landscape';
}

/**
 * チャットセッション フック関連
 */
export interface ChatSessionActions {
  sendMessage: (
    content: string,
    model: string,
    options?: {
      systemPrompt?: string;
      serviceId?: string;
      step7FullBodyGeneration?: boolean;
      /** true のとき過去のチャット履歴を送信しない */
      skipHistory?: boolean;
      /**
       * ストリーム API に送る sessionId。指定時は state の currentSessionId より優先。
       * await 後にセッションが切り替わった場合でも、検証済みのセッションで送るために使う。
       */
      sessionIdOverride?: string;
      /** true のとき途切れた最後の assistant メッセージに続きを連結する（新規メッセージは追加しない） */
      continuationMode?: boolean;
    }
  ) => Promise<boolean>;
  setError: (message: string | null) => void;
  addSystemMessage: (content: string) => void;
  loadSessions: () => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateSessionServiceId: (sessionId: string, serviceId: string) => Promise<void>;
  searchSessions: (query: string, options?: { limit?: number }) => Promise<void>;
  clearSearch: () => void;
  startNewSession: () => void;
}

export interface ChatSessionHook {
  state: ChatState;
  actions: ChatSessionActions;
}
