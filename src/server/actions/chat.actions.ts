'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { ChatResponse } from '@/types/chat';
import { ModelHandlerService } from './chat/modelHandlers';
import { isUnavailable, hasOwnerRole } from '@/authUtils';
import { cookies } from 'next/headers';
import type { UserRole } from '@/types/user';
import { z } from 'zod';
import { SupabaseService } from '@/server/services/supabaseService';
import { parseTimestampOrNull } from '@/lib/timestamps';
import {
  continueChatSchema,
  startChatSchema,
  type ContinueChatInput,
  type StartChatInput,
} from '@/server/schemas/chat.schema';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getEmailLinkConflictMessage } from '@/server/middleware/authMiddlewareGuards';
import { STEP7_ID, toBlogModel } from '@/lib/constants';


const updateChatSessionTitleSchema = z.object({
  sessionId: z.string(),
  title: z.string().min(1).max(60),
  liffAccessToken: z.string(),
});

const searchChatSessionsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  liffAccessToken: z.string(),
});

const modelHandler = new ModelHandlerService();

// 認証チェックを共通化
async function checkAuth(liffAccessToken: string): Promise<
  | { isError: true; error: string; emailLinkConflict?: true }
  | {
      isError: false;
      userId: string;
      role: UserRole;
      viewMode: boolean;
      ownerUserId?: string | null | undefined;
    }
> {
  const authResult = await authMiddleware(liffAccessToken, undefined, {
    allowEmailFallback: true,
  });
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

  const cookieStore = await cookies();
  const isViewMode =
    cookieStore.get('owner_view_mode')?.value === '1' ||
    !!authResult.viewMode ||
    hasOwnerRole(user?.role ?? null);

  return {
    isError: false as const,
    userId: authResult.userId,
    role: user?.role ?? 'trial',
    viewMode: isViewMode,
    ownerUserId: (user?.ownerUserId ?? authResult.ownerUserId) || null,
  };
}

export async function startChat(data: StartChatInput): Promise<ChatResponse> {
  try {
    const validatedData = startChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth(validatedData.liffAccessToken);
    if (auth.isError) {
      return { message: '', error: auth.error };
    }

    // 閲覧専用モードでの書き込み制限（内部でservice_roleを使用しているため明示的なガードが必要）
    if (auth.viewMode) {
      return { message: '', error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
    }

    // モデル処理に委譲
    return await modelHandler.handleStart(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('startChat failed:', e);
    return { message: '', error: ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR };
  }
}

export async function continueChat(data: ContinueChatInput): Promise<ChatResponse> {
  try {
    const validatedData = continueChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth(validatedData.liffAccessToken);
    if (auth.isError) {
      return { message: '', error: auth.error };
    }

    // 閲覧専用モードでの書き込み制限（内部でservice_roleを使用しているため明示的なガードが必要）
    if (auth.viewMode) {
      return { message: '', error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
    }

    // モデル処理に委譲
    return await modelHandler.handleContinue(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('continueChat failed:', e);
    return { message: '', error: ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR };
  }
}

export async function getChatSessions(liffAccessToken: string) {
  const auth = await checkAuth(liffAccessToken);
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

export async function getSessionMessages(sessionId: string, liffAccessToken: string) {
  const auth = await checkAuth(liffAccessToken);
  if (auth.isError) {
    return { messages: [], error: auth.error };
  }
  const targetUserId = auth.ownerUserId || auth.userId;
  const messages = await chatService.getSessionMessages(sessionId, targetUserId);
  return { messages, error: null };
}

export async function getLatestBlogStep7MessageBySession(
  sessionId: string,
  liffAccessToken: string
): Promise<
  | { success: false; error: string }
  | { success: true; data: { content: string; createdAt: string } | null }
> {
  if (!sessionId) {
    return { success: false as const, error: ERROR_MESSAGES.CHAT.SESSION_ID_REQUIRED };
  }

  const auth = await checkAuth(liffAccessToken);
  if (auth.isError) {
    return { success: false as const, error: auth.error };
  }

  const supabase = new SupabaseService();
  const targetUserId = auth.ownerUserId || auth.userId;
  const result = await supabase.getLatestChatMessageBySessionAndModel(
    sessionId,
    targetUserId,
    toBlogModel(STEP7_ID)
  );

  if (!result.success) {
    return { success: false as const, error: result.error.userMessage };
  }

  if (!result.data) {
    return { success: true as const, data: null };
  }

  const createdAt = parseTimestampOrNull(result.data.created_at);
  if (createdAt === null) {
    console.error('[getLatestBlogStep7MessageBySession] Invalid created_at', {
      sessionId,
      createdAt: result.data.created_at,
    });
    return { success: false as const, error: 'タイムスタンプの解析に失敗しました' };
  }

  return {
    success: true as const,
    data: {
      content: result.data.content,
      createdAt,
    },
  };
}

export async function searchChatSessions(data: z.infer<typeof searchChatSessionsSchema>) {
  const parsed = searchChatSessionsSchema.parse(data);

  const auth = await checkAuth(parsed.liffAccessToken);
  if (auth.isError) {
    return { results: [], error: auth.error };
  }

  try {
    const options = parsed.limit !== undefined ? { limit: parsed.limit } : undefined;
    const targetUserId = auth.ownerUserId || auth.userId;
    const matches = await chatService.searchChatSessions(targetUserId, parsed.query ?? '', options);

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

export async function deleteChatSession(sessionId: string, liffAccessToken: string) {
  const auth = await checkAuth(liffAccessToken);
  if (auth.isError) {
    return {
      success: false,
      error: auth.error,
      ...(auth.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
    };
  }

  // 閲覧モード（オーナー含む）での書き込み制限
  if (auth.viewMode) {
    return { success: false, error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
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

export async function updateChatSessionTitle(
  sessionId: string,
  title: string,
  liffAccessToken: string
) {
  const parsed = updateChatSessionTitleSchema.parse({
    sessionId,
    title: title.trim(),
    liffAccessToken,
  });

  const auth = await checkAuth(parsed.liffAccessToken);
  if (auth.isError) {
    return { success: false, error: auth.error };
  }

  // 閲覧モード（オーナー含む）での書き込み制限
  if (auth.viewMode) {
    return { success: false, error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
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

export async function getSessionServiceId(
  sessionId: string,
  liffAccessToken: string
): Promise<{ success: true; data: string | null } | { success: false; error: string }> {
  const auth = await checkAuth(liffAccessToken);
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
  liffAccessToken: z.string(),
});

export async function updateSessionServiceId(
  sessionId: string,
  serviceId: string,
  liffAccessToken: string
) {
  const parsed = updateSessionServiceIdSchema.parse({
    sessionId,
    serviceId,
    liffAccessToken,
  });

  const auth = await checkAuth(parsed.liffAccessToken);
  if (auth.isError) {
    return { success: false, error: auth.error };
  }

  // 閲覧モード（オーナー含む）での書き込み制限
  if (auth.viewMode) {
    return { success: false, error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
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
