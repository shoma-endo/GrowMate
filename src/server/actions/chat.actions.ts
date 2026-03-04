'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { ChatResponse } from '@/types/chat';
import { ModelHandlerService } from './chat/modelHandlers';
import { isUnavailable, getUserRole } from '@/authUtils';
import { cookies } from 'next/headers';
import { userService } from '@/server/services/userService';
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
import { cache } from 'react';

/**
 * ユーザーロールを取得しメモ化する内部関数
 * Next.jsのcacheを使用して同一リクエスト内での外部API呼び出しを最小限に抑える
 */
const getCachedUserRole = cache(async (accessToken: string) => {
  try {
    return await getUserRole(accessToken);
  } catch (error) {
    console.error('Failed to get user role in getCachedUserRole:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
    return null;
  }
});

/**
 * 閲覧モード判定の内部共通ロジック（クッキー判定含む）
 * @returns 閲覧モード（オーナーまたはクッキー設定あり）の場合は true
 */
async function isOwnerViewMode(): Promise<boolean> {
  const cookieStore = await cookies();
  const hasCookie = cookieStore.get('owner_view_mode')?.value === '1';
  if (hasCookie) return true;

  // クッキーがなくてもオーナーであれば閲覧モード扱いとする（書き込み制限のため）
  const accessToken = cookieStore.get('line_access_token')?.value;
  if (!accessToken) return false;

  const role = await getCachedUserRole(accessToken);
  return role === 'owner';
}

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
  | { isError: true; error: string | undefined; requiresSubscription?: boolean }
  | {
      isError: false;
      userId: string;
      role: UserRole;
      viewMode: boolean;
      ownerUserId?: string | null | undefined;
    }
> {
  const authResult = await authMiddleware(liffAccessToken);
  if (authResult.error || authResult.requiresSubscription) {
    return {
      isError: true as const,
      error: authResult.error,
      requiresSubscription: authResult.requiresSubscription,
    };
  }

  // unavailableユーザーのサービス利用制限チェック
  try {
    // 統合的なビューモード判定（クッキー、ロール、およびミドルウェアでの判定を合算）
    const effectiveViewMode = await isOwnerViewMode();
    const isViewMode = effectiveViewMode || !!authResult.viewMode;

    const user =
      authResult.userDetails ?? (await userService.getUserFromLiffToken(liffAccessToken));

    if (user && isUnavailable(user.role)) {
      return {
        isError: true as const,
        error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
        requiresSubscription: false,
      };
    }

    if (!authResult.userId) {
      return {
        isError: true as const,
        error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
        requiresSubscription: false,
      };
    }

    return {
      isError: false as const,
      userId: authResult.userId,
      role: user?.role ?? 'trial',
      viewMode: isViewMode,
      ownerUserId: (user?.ownerUserId ?? authResult.ownerUserId) || null,
    };
  } catch (error) {
    console.error('Auth verification failed in checkAuth:', error);
    return {
      isError: true as const,
      error: ERROR_MESSAGES.USER.USER_INFO_VERIFY_FAILED,
      requiresSubscription: false,
    };
  }
}

export async function startChat(data: StartChatInput): Promise<ChatResponse> {
  try {
    const validatedData = startChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth(validatedData.liffAccessToken);
    if (auth.isError) {
      return {
        message: '',
        error: auth.error,
        requiresSubscription: auth.requiresSubscription,
      };
    }

    // 閲覧専用モードでの書き込み制限（内部でservice_roleを使用しているため明示的なガードが必要）
    if (auth.viewMode) {
      return {
        message: '',
        error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED,
        requiresSubscription: false,
      };
    }

    // モデル処理に委譲
    return await modelHandler.handleStart(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('startChat failed:', e);
    return {
      message: '',
      error: (e as Error).message || ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      requiresSubscription: false,
    };
  }
}

export async function continueChat(data: ContinueChatInput): Promise<ChatResponse> {
  try {
    const validatedData = continueChatSchema.parse(data);

    // 認証チェック
    const auth = await checkAuth(validatedData.liffAccessToken);
    if (auth.isError) {
      return {
        message: '',
        error: auth.error,
        requiresSubscription: auth.requiresSubscription,
      };
    }

    // 閲覧専用モードでの書き込み制限（内部でservice_roleを使用しているため明示的なガードが必要）
    if (auth.viewMode) {
      return {
        message: '',
        error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED,
        requiresSubscription: false,
      };
    }

    // モデル処理に委譲
    return await modelHandler.handleContinue(auth.userId, validatedData);
  } catch (e: unknown) {
    console.error('continueChat failed:', e);
    return {
      message: '',
      error: (e as Error).message || ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      requiresSubscription: false,
    };
  }
}

export async function getChatSessions(liffAccessToken: string) {
  const auth = await checkAuth(liffAccessToken);
  if (auth.isError) {
    return { sessions: [], error: auth.error, requiresSubscription: auth.requiresSubscription };
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
    return { messages: [], error: auth.error, requiresSubscription: auth.requiresSubscription };
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
    return { success: false as const, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  const supabase = new SupabaseService();
  const targetUserId = auth.ownerUserId || auth.userId;
  const result = await supabase.getLatestChatMessageBySessionAndModel(
    sessionId,
    targetUserId,
    'blog_creation_step7'
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
    return {
      results: [],
      error: auth.error,
      requiresSubscription: auth.requiresSubscription,
    };
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
      requiresSubscription: false,
    };
  } catch (error) {
    console.error('Failed to search chat sessions:', error);
    return {
      results: [],
      error: error instanceof Error ? error.message : ERROR_MESSAGES.CHAT.SESSION_SEARCH_FAILED,
      requiresSubscription: false,
    };
  }
}

export async function deleteChatSession(sessionId: string, liffAccessToken: string) {
  const auth = await checkAuth(liffAccessToken);
  if (auth.isError) {
    return { success: false, error: auth.error, requiresSubscription: auth.requiresSubscription };
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
      error: error instanceof Error ? error.message : ERROR_MESSAGES.CHAT.SESSION_DELETE_FAILED,
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
    return { success: false, error: auth.error, requiresSubscription: auth.requiresSubscription };
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
    return { success: false, error: auth.error, requiresSubscription: auth.requiresSubscription };
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
