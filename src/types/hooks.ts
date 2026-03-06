/**
 * フック専用の型定義
 */
import type { SubscriptionStatus as DomainSubscriptionStatus } from '../domain/interfaces/ISubscriptionService';
import type { ChatState } from '../domain/models/chatModels';
import type { getLineProfileServerResponse } from '../server/actions/login.actions';

/**
 * LIFF フック関連
 */
export interface LiffProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

export interface UseLiffResult {
  isLoggedIn: boolean;
  isLoading: boolean;
  error: string | null;
  liffObject: unknown | null;
  profile: LiffProfile | null;
  login: () => void;
  logout: () => void;
  getLineProfile: () => Promise<getLineProfileServerResponse>;
  getAccessToken: () => Promise<string>;
  initLiff: () => Promise<void>;
  clearError: () => void;
}

/**
 * サブスクリプション フック関連
 */
export interface SubscriptionHook {
  subscriptionStatus: DomainSubscriptionStatus | null;
  isLoading: boolean;
  hasInitialized: boolean;
  requiresSubscription: boolean;
  hasActiveSubscription: boolean;
  error: string | null;
  actions: {
    checkSubscription: () => Promise<void>;
    refreshSubscription: () => Promise<void>;
    clearError: () => void;
    resetInitialization: () => void;
  };
}

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
      /** step7FullBodyGeneration 時: 書き出しをユーザープロンプトに渡す */
      step7Lead?: string;
    }
  ) => Promise<boolean>;
  setError: (message: string | null) => void;
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
