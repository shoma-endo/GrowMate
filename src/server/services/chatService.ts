import { llmChat } from './llmService';
import {
  ChatMessage,
  ChatSession,
  ChatSessionSearchMatch,
  DbChatMessage,
  DbChatSession,
  ChatRole,
  toChatMessage,
  toChatSession,
  OpenAIMessage,
  ServerChatSession,
} from '@/types/chat';
import { SupabaseService, type SupabaseResult } from './supabaseService';
import { MODEL_CONFIGS, CHAT_HISTORY_LIMIT, CHAT_HISTORY_CHAR_LIMIT } from '@/lib/constants';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { generateOrderedTimestamps } from '@/lib/timestamps';

interface ChatResponse {
  message: string;
  error?: string;
  requiresSubscription?: boolean;
}

class ChatService {
  private supabaseService: SupabaseService;
  // 必要最低限のトークン管理: 直近の履歴のみ保持
  // 注: CHAT_HISTORY_LIMIT は src/lib/constants.ts で一元管理
  private static readonly MAX_HISTORY_MESSAGES = CHAT_HISTORY_LIMIT;
  private static readonly MAX_HISTORY_CHARS = CHAT_HISTORY_CHAR_LIMIT;

  constructor() {
    this.supabaseService = new SupabaseService();
  }

  private unwrapSupabaseResult<T>(
    result: SupabaseResult<T>,
    code: ChatErrorCode,
    context?: Record<string, unknown>
  ): T {
    if (result.success) {
      return result.data;
    }

    throw new ChatError(result.error.userMessage, code, {
      ...context,
      supabase: result.error,
    });
  }

  /**
   * 新しいチャットを開始する
   */
  async startChat(
    userId: string,
    systemPrompt: string,
    userMessage: string | string[],
    model?: string,
    serviceId?: string
  ): Promise<{
    message: string;
    error?: string;
    sessionId?: string;
    requiresSubscription?: boolean;
  }> {
    try {
      // 制限チェックは呼び出し元（サーバーアクション）でロールに応じて実施
      let aiResponse: ChatResponse;
      let userMessageString: string;
      if (typeof userMessage === 'string') {
        userMessageString = userMessage;
        const config =
          MODEL_CONFIGS[model ?? 'ad_copy_finishing'] ?? MODEL_CONFIGS['ad_copy_finishing']!;
        const providerKey = config.provider;
        const llmModel = config.actualModel;

        try {
          const aiReply = await llmChat(
            providerKey,
            llmModel,
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            { temperature: config.temperature, maxTokens: config.maxTokens }
          );

          aiResponse = { message: aiReply };
        } catch (error) {
          console.error('LLM Chat error:', error);
          // 既にChatErrorであればそのまま投げ直し（文言を上書きしない）
          if (error instanceof ChatError) {
            throw error;
          }
          // 未分類のエラーは汎用化
          throw ChatError.fromApiError(error, { model: llmModel });
        }
      } else {
        userMessageString = userMessage[0]!;
        aiResponse = { message: userMessage[1]!, error: '' };
      }

      const sessionId = crypto.randomUUID();
      const [nowIso, nextIso] = generateOrderedTimestamps(2);

      const session: DbChatSession = {
        id: sessionId,
        user_id: userId,
        title: userMessageString.substring(0, 50) + (userMessageString.length > 50 ? '...' : ''),
        created_at: nowIso,
        last_message_at: nowIso,
        system_prompt: systemPrompt,
        service_id: serviceId ?? null,
        search_vector: null,
      };

      this.unwrapSupabaseResult(
        await this.supabaseService.createChatSession(session),
        ChatErrorCode.SESSION_CREATION_FAILED,
        { userId, session }
      );

      const userDbMessage: DbChatMessage = {
        id: crypto.randomUUID(),
        user_id: userId,
        session_id: sessionId,
        role: ChatRole.USER,
        content: userMessageString,
        created_at: nowIso,
        model: null,
      };

      this.unwrapSupabaseResult(
        await this.supabaseService.createChatMessage(userDbMessage),
        ChatErrorCode.MESSAGE_SEND_FAILED,
        { userId, sessionId, messageId: userDbMessage.id }
      );

      const assistantDbMessage: DbChatMessage = {
        id: crypto.randomUUID(),
        user_id: userId,
        session_id: sessionId,
        role: ChatRole.ASSISTANT,
        content: aiResponse.message,
        model: model ?? null,
        created_at: nextIso, // 順序を保証するため
      };

      this.unwrapSupabaseResult(
        await this.supabaseService.createChatMessage(assistantDbMessage),
        ChatErrorCode.MESSAGE_SEND_FAILED,
        { userId, sessionId, messageId: assistantDbMessage.id }
      );

      return {
        ...aiResponse,
        sessionId,
      };
    } catch (error) {
      if (error instanceof ChatError) {
        console.error('Chat domain error:', error);
        return { message: '', error: error.userMessage };
      }
      console.error('Failed to start chat:', error);
      throw new ChatError('チャットの開始に失敗しました', ChatErrorCode.SESSION_CREATION_FAILED, {
        userId,
        error,
      });
    }
  }

  /**
   * 既存のチャットを継続する
   */
  async continueChat(
    userId: string,
    sessionId: string,
    userMessage: string | string[],
    systemPrompt: string,
    messages: OpenAIMessage[],
    model?: string
  ): Promise<{
    message: string;
    error?: string;
    sessionId?: string;
    requiresSubscription?: boolean;
  }> {
    try {
      // 制限チェックは呼び出し元（サーバーアクション）でロールに応じて実施
      let aiResponse: ChatResponse;
      let userMessageString: string;
      if (typeof userMessage === 'string') {
        userMessageString = userMessage;
        const config =
          MODEL_CONFIGS[model ?? 'ad_copy_finishing'] ?? MODEL_CONFIGS['ad_copy_finishing']!;
        const providerKey = config.provider;
        const llmModel = config.actualModel;

        try {
          // Kターン制限 & 文字数制限 + 古い履歴の簡易要約
          let recentMessages: OpenAIMessage[] = [];
          let olderMessages: OpenAIMessage[] = [];
          let finalSystemPrompt = systemPrompt;

          // 1. まず件数でフィルタリング（最新 K 件のみ対象候補）
          const countLimitedMessages = messages.slice(-ChatService.MAX_HISTORY_MESSAGES);
          
          // 件数制限で溢れた古いメッセージ
          const countOverflowMessages = messages.slice(0, Math.max(0, messages.length - ChatService.MAX_HISTORY_MESSAGES));

          // 2. 文字数でフィルタリング（最新から遡って許容文字数まで）
          let currentChars = 0;
          let cutOffIndex = 0; // countLimitedMessages の中で、ここより後ろを採用

          for (let i = countLimitedMessages.length - 1; i >= 0; i--) {
            const msg = countLimitedMessages[i];
            const msgLen = msg ? msg.content.length : 0;
            if (currentChars + msgLen > ChatService.MAX_HISTORY_CHARS) {
              cutOffIndex = i + 1; // これを含めず、次（より新しいもの）から採用
              break;
            }
            currentChars += msgLen;
          }

          // 最低でも最新の1件は含めるための調整（履歴が空でない場合）
          const effectiveCutOffIndex =
            countLimitedMessages.length > 0
              ? Math.min(cutOffIndex, countLimitedMessages.length - 1)
              : cutOffIndex;

          recentMessages = countLimitedMessages.slice(effectiveCutOffIndex);

          // 文字数制限で溢れたメッセージ + 件数制限で溢れたメッセージ = 要約対象
          const charOverflowMessages = countLimitedMessages.slice(0, effectiveCutOffIndex);
          olderMessages = [...countOverflowMessages, ...charOverflowMessages];

          if (olderMessages.length > 0) {
            try {
              const summary = await this.summarizeHistory(olderMessages);
              if (summary && summary.trim().length > 0) {
                finalSystemPrompt = `${systemPrompt}\n\n【直前までの会話要約】\n${summary}`;
              }
            } catch (error) {
              console.warn('[ChatService] History summarization failed:', error);
              // 要約に失敗しても直近のみで続行
            }
          }

          const llmMessages = [
            { role: 'system' as const, content: finalSystemPrompt },
            ...recentMessages.map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user' as const, content: userMessage },
          ];

          const aiReply = await llmChat(providerKey, llmModel, llmMessages, {
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          });

          aiResponse = { message: aiReply };
        } catch (error) {
          console.error('LLM Chat error:', error);
          if (error instanceof ChatError) {
            throw error;
          }
          throw ChatError.fromApiError(error, { model: llmModel, sessionId });
        }
      } else {
        userMessageString = userMessage[0]!;
        aiResponse = { message: userMessage[1]!, error: '' };
      }

      const [nowIso, nextIso] = generateOrderedTimestamps(2);

      this.unwrapSupabaseResult(
        await this.supabaseService.updateChatSession(sessionId, userId, {
          last_message_at: nowIso,
        }),
        ChatErrorCode.SESSION_LOAD_FAILED,
        { userId, sessionId }
      );

      const userDbMessage: DbChatMessage = {
        id: crypto.randomUUID(),
        user_id: userId,
        session_id: sessionId,
        role: ChatRole.USER,
        content: userMessageString,
        created_at: nowIso,
        model: null,
      };

      this.unwrapSupabaseResult(
        await this.supabaseService.createChatMessage(userDbMessage),
        ChatErrorCode.MESSAGE_SEND_FAILED,
        { userId, sessionId, messageId: userDbMessage.id }
      );

      const assistantDbMessage: DbChatMessage = {
        id: crypto.randomUUID(),
        user_id: userId,
        session_id: sessionId,
        role: ChatRole.ASSISTANT,
        content: aiResponse.message,
        model: model ?? null,
        created_at: nextIso, // 順序を保証するため
      };

      this.unwrapSupabaseResult(
        await this.supabaseService.createChatMessage(assistantDbMessage),
        ChatErrorCode.MESSAGE_SEND_FAILED,
        { userId, sessionId, messageId: assistantDbMessage.id }
      );

      return {
        ...aiResponse,
        sessionId,
      };
    } catch (error) {
      if (error instanceof ChatError) {
        console.error('Chat domain error:', error);
        return { message: '', error: error.userMessage };
      }
      console.error('Failed to continue chat:', error);
      throw new ChatError('チャットの継続に失敗しました', ChatErrorCode.MESSAGE_SEND_FAILED, {
        userId,
        sessionId,
        error,
      });
    }
  }

  /**
   * セッションのサービスIDを更新
   */
  async updateSessionServiceId(userId: string, sessionId: string, serviceId: string): Promise<void> {
    try {
      this.unwrapSupabaseResult(
        await this.supabaseService.updateSessionServiceId(sessionId, userId, serviceId),
        ChatErrorCode.SESSION_UPDATE_FAILED,
        { userId, sessionId, serviceId }
      );
    } catch (error) {
      if (error instanceof ChatError) {
        console.error('Chat domain error:', error);
        throw error;
      }
      console.error('Failed to update session service ID:', error);
      throw new ChatError(
        'チャットセッションの更新に失敗しました',
        ChatErrorCode.SESSION_UPDATE_FAILED,
        { userId, sessionId, serviceId, error }
      );
    }
  }

  /**
   * ユーザーのチャットセッション一覧を取得
   */
  async getUserSessions(userId: string): Promise<ChatSession[]> {
    try {
      const dbSessions = this.unwrapSupabaseResult(
        await this.supabaseService.getUserChatSessions(userId),
        ChatErrorCode.SESSION_LOAD_FAILED,
        { userId }
      );
      return dbSessions.map(session => toChatSession(session));
    } catch (error) {
      console.error('Failed to get user sessions:', error);
      throw new ChatError(
        'チャットセッションの取得に失敗しました',
        ChatErrorCode.SESSION_LOAD_FAILED,
        { userId, error }
      );
    }
  }

  async searchChatSessions(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<ChatSessionSearchMatch[]> {
    try {
      const dbMatches = this.unwrapSupabaseResult(
        await this.supabaseService.searchChatSessions(userId, query, options),
        ChatErrorCode.SESSION_LOAD_FAILED,
        { userId, query, options }
      );

      return dbMatches.map(match => ({
        sessionId: match.session_id,
        title: match.title,
        canonicalUrl: match.canonical_url ?? null,
        wordpressTitle: match.wp_post_title ?? null,
        lastMessageAt: match.last_message_at,
        similarityScore: match.similarity_score,
      }));
    } catch (error) {
      console.error('Failed to search user sessions:', error);
      throw new ChatError(
        'チャットセッションの検索に失敗しました',
        ChatErrorCode.SESSION_LOAD_FAILED,
        {
          userId,
          query,
          error,
        }
      );
    }
  }

  /**
   * セッションのメッセージ一覧を取得
   */
  async getSessionMessages(sessionId: string, userId: string): Promise<ChatMessage[]> {
    try {
      const dbMessages = this.unwrapSupabaseResult(
        await this.supabaseService.getChatMessagesBySessionId(sessionId, userId),
        ChatErrorCode.MESSAGE_LOAD_FAILED,
        { sessionId, userId }
      );
      return dbMessages.map(message => toChatMessage(message));
    } catch (error) {
      console.error('Failed to get session messages:', error);
      throw new ChatError('メッセージの取得に失敗しました', ChatErrorCode.MESSAGE_LOAD_FAILED, {
        sessionId,
        userId,
        error,
      });
    }
  }

  /**
   * チャットセッションを削除
   */
  async deleteChatSession(sessionId: string, userId: string): Promise<void> {
    try {
      this.unwrapSupabaseResult(
        await this.supabaseService.deleteChatSession(sessionId, userId),
        ChatErrorCode.SESSION_DELETE_FAILED,
        { sessionId, userId }
      );
    } catch (error) {
      console.error('Failed to delete chat session:', error);
      throw new ChatError(
        'チャットセッションの削除に失敗しました',
        ChatErrorCode.SESSION_DELETE_FAILED,
        { sessionId, userId, error }
      );
    }
  }

  /**
   * Server Component用: セッションとメッセージを一括取得（RPC関数を使用）
   * N+1問題を解消し、パフォーマンスを向上
   */
  async getSessionsWithMessages(
    userId: string,
    options?: { limit?: number }
  ): Promise<ServerChatSession[]> {
    return this.unwrapSupabaseResult(
      await this.supabaseService.getSessionsWithMessages(userId, options),
      ChatErrorCode.SESSION_LOAD_FAILED,
      { userId, limit: options?.limit }
    );
  }

  /**
   * 古い履歴を簡易要約（日本語・箇条書き・約300文字）
   */
  private async summarizeHistory(messages: OpenAIMessage[]): Promise<string> {
    const target = messages.slice(-8);
    const serialized = target
      .map(
        m =>
          `${m.role === 'user' ? 'ユーザー' : m.role === 'assistant' ? 'アシスタント' : 'システム'}: ${m.content}`
      )
      .join('\n');

    const system =
      'あなたは会話要約のアシスタントです。過去の会話を日本語で最重要ポイントのみ、箇条書きで3〜6項目、合計300文字程度で要約してください。前置きや蛇足は不要です。';

    const summarizerModel =
      MODEL_CONFIGS['ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2']?.actualModel || 'gpt-4o-mini';

    const text = await llmChat(
      'openai',
      summarizerModel,
      [
        { role: 'system', content: system },
        { role: 'user', content: serialized.slice(0, 4000) },
      ],
      { temperature: 0.2, maxTokens: 600 }
    );

    return text;
  }
}

export const chatService = new ChatService();
