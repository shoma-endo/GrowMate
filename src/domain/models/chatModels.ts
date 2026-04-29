import { ChatMessage, ChatSession } from '../interfaces/IChatService';
import type { ChatSessionSearchResult } from '../interfaces/IChatService';

export interface ChatState {
  readonly messages: ChatMessage[];
  readonly sessions: ChatSession[];
  readonly currentSessionId: string;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly warning: string | null;
  readonly searchQuery: string;
  readonly searchResults: ChatSessionSearchResult[];
  readonly isSearching: boolean;
  readonly searchError: string | null;
  readonly isTruncated: boolean;
}

export const initialChatState: ChatState = {
  messages: [],
  sessions: [],
  currentSessionId: '',
  isLoading: false,
  error: null,
  warning: null,
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  searchError: null,
  isTruncated: false,
};

export const createUserMessage = (content: string, model?: string): ChatMessage => ({
  id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  role: 'user',
  content,
  timestamp: new Date(),
  model: model || undefined,
});

export const createAssistantMessage = (content: string, model?: string | undefined): ChatMessage => ({
  id: `assistant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  role: 'assistant',
  content,
  timestamp: new Date(),
  model: model || undefined,
});

export const createSystemMessage = (content: string): ChatMessage => ({
  id: `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  role: 'system',
  content,
  timestamp: new Date(),
});
