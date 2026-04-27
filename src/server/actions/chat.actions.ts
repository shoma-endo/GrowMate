'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { ChatResponse } from '@/types/chat';
import { ModelHandlerService } from './chat/modelHandlers';
import { isUnavailable } from '@/authUtils';
import type { UserRole } from '@/types/user';
import { z } from 'zod';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  continueChatSchema,
  startChatSchema,
  type ContinueChatInput,
  type StartChatInput,
} from '@/server/schemas/chat.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getEmailLinkConflictMessage } from '@/server/middleware/authMiddlewareGuards';


const updateChatSessionTitleSchema = z.object({
  sessionId: z.string(),
  title: z.string().min(1).max(60),
});

const searchChatSessionsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const modelHandler = new ModelHandlerService();

// 認証チェックを共通化
async function checkAuth(): Promise<
  | { isError: true; error: string; emailLinkConflict?: true }
  | {
      isError: false;
      userId: string;
      role: UserRole;
    }
> {
  const authResult = await authMiddleware();
  const conflictMessage = getEmailLinkConflictMessage(authResult);
  if (conflictMessage !== undefined) {
    return { isError: true as const, error: conflictMessage, emailLinkConflict: true as const };
  }
  if (authResult.error) {
    return {
      isError: true as const,
      error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
    };
  }

  if (!authResult.userId) {
    return { isError: true as const, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  const user = authResult.userDetails;

  if (user && isUnavailable(user.role)) {
    return { isError: true as const, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
  }

  return {
    isError: false as const,
    userId: authResult.userId,
    role: user?.role ?? 'trial',
  };
}

async function startChat(data: StartChatInput): Promise<ChatResponse> {
  try {
    const validatedData = startChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth();
    if (auth.isError) {
      return { message: '', error: auth.error };
    }

    // モデル処理に委譲
    return await modelHandler.handleStart(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('startChat failed:', e);
    return { message: '', error: ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR };
  }
}

async function continueChat(data: ContinueChatInput): Promise<ChatResponse> {
  try {
    const validatedData = continueChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth();
    if (auth.isError) {
      return { message: '', error: auth.error };
    }

    // モデル処理に委譲
    return await modelHandler.handleContinue(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('continueChat failed:', e);
    return { message: '', error: ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR };
  }
}

async function getChatSessions() {
  const auth = await checkAuth();
  if (auth.isError) {
    return { sessions: [], error: auth.error };
  }

  // RPC関数を使用してオーナー/従業員の相互閲覧に対応
  const targetUserId = auth.userId; // 自分のIDを渡す（RPC内でget_accessible_user_idsを使用）
  const serverSessions = await chatService.getSessionsWithMessages(targetUserId);
  // ServerChatSession → ChatSession形式に変換
  const sessions = serverSessions.map(s => ({
    id: s.id,
    title: s.title,
    lastMessageAt: s.last_message_at,
    createdAt: s.last_message_at, // 互換性のため
    userId: '', // 不要だが型互換のため
    systemPrompt: null,
    searchVector: null,
  }));
  return { sessions, error: null };
}

async function getSessionMessages(sessionId: string) {
  const auth = await checkAuth();
  if (auth.isError) {
    return { messages: [], error: auth.error };
  }
  const messages = await chatService.getSessionMessages(sessionId, auth.userId);
  return { messages, error: null };
}

async function searchChatSessions(data: z.infer<typeof searchChatSessionsSchema>) {
  const parsed = searchChatSessionsSchema.parse(data);

  const auth = await checkAuth();
  if (auth.isError) {
    return { results: [], error: auth.error };
  }

  try {
    const options = parsed.limit !== undefined ? { limit: parsed.limit } : undefined;
    const matches = await chatService.searchChatSessions(auth.userId, parsed.query ?? '', options);

    return {
      results: matches.map(match => ({
        sessionId: match.sessionId,
        title: match.title,
        canonicalUrl: match.canonicalUrl,
        wordpressTitle: match.wordpressTitle,
        lastMessageAt: match.lastMessageAt,
        similarityScore: match.similarityScore,
      })),
      error: null,
    };
  } catch (error) {
    console.error('Failed to search chat sessions:', error);
    return {
      results: [],
      error: ERROR_MESSAGES.CHAT.SESSION_SEARCH_FAILED,
    };
  }
}

async function deleteChatSession(sessionId: string) {
  const auth = await checkAuth();
  if (auth.isError) {
    return {
      success: false,
      error: auth.error,
      ...(auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
    };
  }

  try {
    await chatService.deleteChatSession(sessionId, auth.userId);
    return { success: true, error: null };
  } catch (error) {
    console.error('Failed to delete chat session:', error);
    return {
      success: false,
      error: ERROR_MESSAGES.CHAT.SESSION_DELETE_FAILED,
    };
  }
}

async function updateChatSessionTitle(
  sessionId: string,
  title: string
) {
  const parsed = updateChatSessionTitleSchema.parse({
    sessionId,
    title: title.trim(),
  });

  const auth = await checkAuth();
  if (auth.isError) {
    return { success: false, error: auth.error };
  }

  const supabase = new SupabaseService();
  const updateResult = await supabase.updateChatSession(parsed.sessionId, auth.userId, {
    title: parsed.title.trim(),
  });

  if (!updateResult.success) {
    return { success: false, error: updateResult.error.userMessage };
  }

  return { success: true, error: null };
}

async function getSessionServiceId(
  sessionId: string
): Promise<{ success: true; data: string | null } | { success: false; error: string }> {
  const auth = await checkAuth();
  if (auth.isError) {
    return { success: false, error: auth.error ?? 'Auth failed' };
  }

  const supabase = new SupabaseService();
  const result = await supabase.getSessionServiceId(sessionId, auth.userId);

  if (!result.success) {
    return { success: false, error: result.error.userMessage };
  }

  return { success: true, data: result.data };
}

const updateSessionServiceIdSchema = z.object({
  sessionId: z.string(),
  serviceId: z.string(),
});

async function updateSessionServiceId(
  sessionId: string,
  serviceId: string
) {
  const parsed = updateSessionServiceIdSchema.parse({
    sessionId,
    serviceId,
  });

  const auth = await checkAuth();
  if (auth.isError) {
    return { success: false, error: auth.error };
  }

  const supabase = new SupabaseService();
  const updateResult = await supabase.updateSessionServiceId(
    parsed.sessionId,
    auth.userId,
    parsed.serviceId
  );

  if (!updateResult.success) {
    return { success: false, error: updateResult.error.userMessage };
  }

  return { success: true, error: null };
}

// === Server Action aliases (for client-side import) ===
export const startChatSA = startChat;
export const continueChatSA = continueChat;
export const getChatSessionsSA = getChatSessions;
export const getSessionMessagesSA = getSessionMessages;
export const deleteChatSessionSA = deleteChatSession;
export const updateChatSessionTitleSA = updateChatSessionTitle;
export const searchChatSessionsSA = searchChatSessions;
export const getSessionServiceIdSA = getSessionServiceId;
export const updateSessionServiceIdSA = updateSessionServiceId;
