import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { SupabaseClientManager } from '@/lib/client-manager';
import { formatJstDateISO } from '@/lib/date-utils';
import { parseTimestampSafe, toIsoTimestamp } from '@/lib/timestamps';
import type { Database, Json, TablesUpdate } from '@/types/database.types';
import {
  DbChatMessage,
  DbChatSession,
  DbChatSessionSearchRow,
  ServerChatMessage,
  ServerChatSession,
} from '@/types/chat';
import type { DbUser, DbUserInsert, DbUserUpdate } from '@/types/user';
import type { UserRole } from '@/types/user';
import type {
  ContentInventoryItem,
  GoogleAdsEvaluationSettingsRecord,
  GscDataFreshness,
  RankingSnapshotItem,
  UpsertGoogleAdsEvaluationSettingsInput,
} from '@/types/google-ads-evaluation';
import type {
  GoogleAdsNegativeKeywordsSuggestionSettingsRecord,
  UpsertGoogleAdsNegativeKeywordsSuggestionSettingsInput,
} from '@/types/google-ads-negative-keywords-suggestion';
import type { GscCredential, GscPropertyType, GscSearchType } from '@/types/gsc';
import { WordPressSettings, WordPressType } from '@/types/wordpress';
import { normalizeContentTypes } from '@/server/services/wordpressContentTypes';

interface SupabaseErrorInfo {
  userMessage: string;
  developerMessage?: string | undefined;
  code?: string | undefined;
  details?: string | null | undefined;
  hint?: string | null | undefined;
  context?: Record<string, unknown> | undefined;
}

export type SupabaseResult<T> =
  | { success: true; data: T }
  | { success: false; error: SupabaseErrorInfo };

type GoogleAdsEvaluationSettingsTable = {
  Row: {
    id: string;
    user_id: string;
    date_range_days: number;
    last_evaluated_on: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    user_id: string;
    date_range_days?: number;
    last_evaluated_on?: string | null;
    updated_at?: string;
  };
  Update: {
    date_range_days?: number;
    last_evaluated_on?: string | null;
    updated_at?: string;
  };
  Relationships: [];
};

type GoogleAdsNegativeKeywordsSettingsTable = {
  Row: {
    id: string;
    user_id: string;
    enabled: boolean;
    send_hour_jst: number;
    last_sent_on: string | null;
    last_send_error: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    user_id: string;
    enabled?: boolean;
    send_hour_jst?: number;
    last_sent_on?: string | null;
    last_send_error?: string | null;
    updated_at?: string;
  };
  Update: {
    enabled?: boolean;
    send_hour_jst?: number;
    last_sent_on?: string | null;
    last_send_error?: string | null;
    updated_at?: string;
  };
  Relationships: [];
};

type ExtendedDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Database['public']['Tables'] & {
      google_ads_evaluation_settings: GoogleAdsEvaluationSettingsTable;
      google_ads_negative_keywords_settings: GoogleAdsNegativeKeywordsSettingsTable;
    };
  };
};

/**
 * SupabaseServiceクラス: サーバーサイドでSupabaseを操作するためのサービス
 * SERVICE_ROLEを使用して特権操作を提供
 * 最適化：シングルトンクライアントで接続プールを効率化
 */
export class SupabaseService {
  protected readonly supabase: SupabaseClient<Database>;

  constructor() {
    // サーバーサイドの特権操作に対応するため、Service Roleクライアントを使用
    // （RLSをバイパスして安全にサーバー側でのみ実行）
    this.supabase = SupabaseClientManager.getInstance().getServiceRoleClient();
  }

  protected success<T>(data: T): SupabaseResult<T> {
    return { success: true, data };
  }

  protected failure(
    userMessage: string,
    {
      error,
      developerMessage,
      context,
    }: {
      error?: PostgrestError | Error;
      developerMessage?: string;
      context?: Record<string, unknown>;
    } = {}
  ): SupabaseResult<never> {
    const info: SupabaseErrorInfo = {
      userMessage,
    };

    if (developerMessage !== undefined) {
      info.developerMessage = developerMessage;
    }

    if (context !== undefined) {
      info.context = context;
    }

    if (info.developerMessage === undefined) {
      info.developerMessage = userMessage;
    }

    if (error) {
      if ('code' in error && typeof error.code === 'string') {
        info.code = error.code;
      }
      if ('details' in error && typeof error.details !== 'undefined') {
        info.details = error.details as string | null | undefined;
      }
      if ('hint' in error && typeof error.hint !== 'undefined') {
        info.hint = error.hint as string | null | undefined;
      }

      console.error('[SupabaseService] Operation failed:', {
        developerMessage: info.developerMessage ?? developerMessage,
        code: info.code,
        details: info.details,
        hint: info.hint,
        context: info.context,
        rawError: error,
      });
    } else {
      console.error('[SupabaseService] Operation failed without PostgrestError', {
        developerMessage: info.developerMessage ?? developerMessage,
        context: info.context ?? context,
      });
    }

    return { success: false, error: info };
  }

  /**
   * PostgREST の Max rows（db-max-rows, 既定1000）を超える件数を range ページングで全件取得する汎用ヘルパー。
   *
   * - `runPage(from, to)` は range を適用したクエリ結果（PromiseLike）を返すこと。
   *   `.select(..., { count: 'exact' })` を付けると総件数で確実に停止できる（推奨）。
   * - `pageSize` は **db-max-rows 以下**にすること（既定1000）。超えると各ページがクランプされ
   *   `batch.length < pageSize` で早期終了し取りこぼす。
   * - ページング安定化のため、呼び出し側の `order` は**決定的（タイブレーク付き）**にすること。
   * - `maxRows` を渡すとその件数で打ち切り `truncated=true` を返す（暴走防止の任意上限）。
   */
  protected async fetchAllPaged<T>(
    runPage: (
      from: number,
      to: number
    ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null; count: number | null }>,
    options: { pageSize?: number; maxRows?: number } = {}
  ): Promise<{ data: T[]; error: PostgrestError | null; truncated: boolean }> {
    const pageSize = options.pageSize ?? 1000;
    const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
    const all: T[] = [];
    let total: number | null = null;

    for (let from = 0; from < maxRows; from += pageSize) {
      const to = Math.min(from + pageSize, maxRows) - 1;
      const { data, error, count } = await runPage(from, to);
      if (error) {
        return { data: all, error, truncated: false };
      }
      if (count !== null && count !== undefined) {
        total = count;
      }
      const batch = data ?? [];
      all.push(...batch);
      // 空ページ＝終端。短いページ＝（count未指定時の）終端判定。count があれば総件数で停止。
      if (batch.length === 0 || batch.length < pageSize) {
        break;
      }
      if (total !== null && all.length >= total) {
        break;
      }
    }

    const truncated = total !== null && all.length < total;
    return { data: all, error: null, truncated };
  }

  /**
   * Supabaseクライアントを取得（サブクラスからのアクセス用）
   */
  getClient(): SupabaseClient<Database> {
    return this.supabase;
  }

  protected static async withServiceRoleClient<T>(
    handler: (client: SupabaseClient<Database>) => Promise<T>,
    options?: {
      logMessage?: string | null;
      logLevel?: 'error' | 'warn' | 'info' | 'debug';
      onError?: (error: unknown) => T;
    }
  ): Promise<T> {
    const client = SupabaseClientManager.getInstance().getServiceRoleClient();

    try {
      return await handler(client);
    } catch (error) {
      const { logLevel = 'error', logMessage = 'Supabase service role operation error' } =
        options ?? {};

      if (logMessage) {
        console[logLevel](logMessage, error);
      }

      if (options?.onError) {
        return options.onError(error);
      }

      throw error;
    }
  }

  async getUserById(id: string): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の取得に失敗しました', {
        error,
        developerMessage: 'Error getting user by ID',
        context: { id },
      });
    }

    return this.success(data ?? null);
  }

  async getUserBySupabaseAuthId(supabaseAuthId: string): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('supabase_auth_id', supabaseAuthId)
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の取得に失敗しました', {
        error,
        developerMessage: 'Error getting user by Supabase Auth ID',
        context: { supabaseAuthId },
      });
    }

    return this.success(data ?? null);
  }

  async getUserByEmail(email: string): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の取得に失敗しました', {
        error,
        developerMessage: 'Error getting user by email',
        context: { email },
      });
    }

    return this.success(data ?? null);
  }

  async createEmailUser(email: string, supabaseAuthId: string): Promise<SupabaseResult<DbUser>> {
    const now = new Date().toISOString();
    const insert: DbUserInsert = {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      last_login_at: now,
      email: email.toLowerCase(),
      supabase_auth_id: supabaseAuthId,
      line_user_id: null,
      line_display_name: null,
      line_picture_url: null,
      line_status_message: null,
      full_name: null,
      role: 'unavailable',
      owner_user_id: null,
      owner_previous_role: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
    };

    const { data, error } = await this.supabase.from('users').insert(insert).select('*').single();

    if (error) {
      return this.failure('メールユーザーの作成に失敗しました', {
        error,
        developerMessage: 'Error creating email user',
        context: { email, supabaseAuthId },
      });
    }

    return this.success(data);
  }

  async createUser(user: DbUserInsert): Promise<SupabaseResult<DbUser>> {
    const { data, error } = await this.supabase.from('users').insert(user).select('*').single();

    if (error) {
      return this.failure('ユーザーの作成に失敗しました', {
        error,
        developerMessage: 'Error creating user',
        context: { userId: user.id, lineUserId: user.line_user_id },
      });
    }

    return this.success(data ?? user);
  }

  async updateUserById(
    id: string,
    updates: DbUserUpdate
  ): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の更新に失敗しました', {
        error,
        developerMessage: 'Error updating user by ID',
        context: { id, updates },
      });
    }

    return this.success(data ?? null);
  }

  async updateUserRole(userId: string, newRole: UserRole): Promise<SupabaseResult<DbUser | null>> {
    return this.updateUserById(userId, {
      role: newRole,
      updated_at: new Date().toISOString(),
    });
  }

  async getAllUsers(): Promise<SupabaseResult<DbUser[]>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return this.failure('ユーザー一覧の取得に失敗しました', {
        error,
        developerMessage: 'Error fetching all users',
      });
    }

    return this.success(data ?? []);
  }

  async createChatSession(session: DbChatSession): Promise<SupabaseResult<string>> {
    const { data, error } = await this.supabase
      .from('chat_sessions')
      .insert(session)
      .select('id')
      .single();

    if (error) {
      return this.failure('チャットセッションの作成に失敗しました', {
        error,
        developerMessage: 'Failed to create chat session',
        context: { sessionId: session.id, userId: session.user_id },
      });
    }

    if (!data?.id) {
      return this.failure('チャットセッションの作成に失敗しました', {
        developerMessage: 'Chat session insert returned no id',
        context: { session },
      });
    }

    return this.success(data.id);
  }

  async getChatSessionById(
    sessionId: string,
    userId: string
  ): Promise<SupabaseResult<DbChatSession | null>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .in('user_id', accessibleIds)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return this.success(null);
      }
      return this.failure('チャットセッションの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get chat session',
        context: { sessionId, userId },
      });
    }

    return this.success(data ?? null);
  }

  async getUserChatSessions(userId: string): Promise<SupabaseResult<DbChatSession[]>> {
    const { data, error } = await this.supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false });

    if (error) {
      return this.failure('チャットセッションの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get user chat sessions',
        context: { userId },
      });
    }

    return this.success(data ?? []);
  }

  /**
   * チャットセッションに紐づくサービスIDを取得
   * オーナー/スタッフ間のアクセス制御に対応
   */
  async getSessionServiceId(
    sessionId: string,
    userId: string
  ): Promise<SupabaseResult<string | null>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_sessions')
      .select('service_id')
      .eq('id', sessionId)
      .in('user_id', accessibleIds)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return this.success(null);
      }
      return this.failure('セッションのサービスID取得に失敗しました', {
        error,
        developerMessage: 'Failed to get session service_id',
        context: { sessionId, userId },
      });
    }

    return this.success(data?.service_id ?? null);
  }

  /**
   * セッションの最新完成形（session_combined_contents.is_latest = true）を取得
   * オーナー/スタッフ間のアクセス制御に対応
   */
  async getLatestCombinedContentBySession(
    sessionId: string,
    userId: string
  ): Promise<SupabaseResult<string | null>> {
    const sessionResult = await this.getChatSessionById(sessionId, userId);
    if (!sessionResult.success) {
      return this.failure('セッションのアクセス確認に失敗しました', {
        developerMessage: 'Failed to verify session access before reading latest combined content',
        context: { sessionId, userId },
      });
    }
    if (!sessionResult.data) {
      return this.failure('セッションへのアクセス権がありません', {
        developerMessage: 'Unauthorized session access for latest combined content',
        context: { sessionId, userId },
      });
    }

    const { data, error } = await this.supabase
      .from('session_combined_contents')
      .select('content')
      .eq('session_id', sessionId)
      .eq('is_latest', true)
      .maybeSingle();

    if (error) {
      return this.failure('最新完成形の取得に失敗しました', {
        error,
        developerMessage: 'Failed to get latest combined content by session',
        context: { sessionId, userId },
      });
    }

    return this.success(data?.content ?? null);
  }

  /**
   * チャットセッションのサービスIDを更新
   * オーナー/スタッフ間のアクセス制御に対応
   */
  async updateSessionServiceId(
    sessionId: string,
    userId: string,
    serviceId: string
  ): Promise<SupabaseResult<void>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_sessions')
      .update({ service_id: serviceId })
      .eq('id', sessionId)
      .in('user_id', accessibleIds)
      .select('id');

    if (error) {
      return this.failure('セッションのサービスID更新に失敗しました', {
        error,
        developerMessage: 'Failed to update session service_id',
        context: { sessionId, userId, serviceId },
      });
    }

    // 更新件数の検証: 0行の場合はセッションが存在しないか権限がない
    if (!data || data.length === 0) {
      return this.failure('セッションが見つからないか、更新権限がありません', {
        developerMessage: 'No rows updated - session not found or no permission',
        context: { sessionId, userId, serviceId },
      });
    }

    return this.success(undefined);
  }

  /**
   * セッションとメッセージを一括取得（RPC関数を使用）
   * N+1問題を解消し、パフォーマンスを向上
   */
  async getSessionsWithMessages(
    userId: string,
    options?: { limit?: number }
  ): Promise<SupabaseResult<ServerChatSession[]>> {
    const limit = options?.limit ?? 20;
    const { data, error } = await this.supabase.rpc('get_sessions_with_messages', {
      p_user_id: userId,
      p_limit: limit,
    });

    if (error) {
      return this.failure('セッション取得に失敗しました', {
        error,
        developerMessage: 'Failed to get sessions with messages (RPC)',
        context: { userId, limit },
      });
    }

    type SessionsWithMessagesRow =
      Database['public']['Functions']['get_sessions_with_messages']['Returns'][number];

    const sessions = (Array.isArray(data) ? data : []).map((row: SessionsWithMessagesRow) => ({
      id: row.session_id,
      title: row.title,
      last_message_at: parseTimestampSafe(row.last_message_at),
      messages: Array.isArray(row.messages)
        ? row.messages
            .filter((message): message is { [key: string]: Json | undefined } => {
              return !!message && typeof message === 'object' && !Array.isArray(message);
            })
            .map(message => ({
              id: String(message.id ?? ''),
              role: String(message.role ?? 'user') as ServerChatMessage['role'],
              content: String(message.content ?? ''),
              created_at: parseTimestampSafe(
                (message as { created_at?: string | number | null }).created_at
              ),
            }))
        : [],
    }));

    return this.success(sessions);
  }

  async searchChatSessions(
    userId: string,
    query: string,
    options?: { limit?: number }
  ): Promise<SupabaseResult<DbChatSessionSearchRow[]>> {
    const limit = options?.limit ?? 20;
    const { data, error } = await this.supabase.rpc('search_chat_sessions', {
      p_user_id: userId,
      p_query: query,
      p_limit: limit,
    });

    if (error) {
      return this.failure('チャットセッションの検索に失敗しました', {
        error,
        developerMessage: 'Failed to search chat sessions',
        context: { userId, query, limit },
      });
    }

    type SearchSessionRow =
      Database['public']['Functions']['search_chat_sessions']['Returns'][number];

    const rows = (Array.isArray(data) ? data : []).map((row: SearchSessionRow) => ({
      session_id: String(row.session_id),
      title: typeof row.title === 'string' ? row.title : '',
      canonical_url:
        row.canonical_url === null || typeof row.canonical_url === 'string'
          ? row.canonical_url
          : null,
      wp_post_title:
        row.wp_post_title === null || typeof row.wp_post_title === 'string'
          ? row.wp_post_title
          : null,
      last_message_at: parseTimestampSafe(row.last_message_at),
      similarity_score:
        row.similarity_score === null || row.similarity_score === undefined
          ? 0
          : Number(row.similarity_score),
    })) as DbChatSessionSearchRow[];

    return this.success(rows);
  }

  async updateChatSession(
    sessionId: string,
    userId: string,
    updates: Partial<DbChatSession>
  ): Promise<SupabaseResult<void>> {
    const { error } = await this.supabase
      .from('chat_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('user_id', userId); // これがないと他人のチャット履歴も更新できてしまう

    if (error) {
      return this.failure('チャットセッションの更新に失敗しました', {
        error,
        developerMessage: 'Failed to update chat session',
        context: { sessionId, userId, updates },
      });
    }

    return this.success(undefined);
  }

  /** オーナー/スタッフのアクセス権を考慮して last_message_at を更新 */
  async updateSessionLastMessageAt(
    sessionId: string,
    userId: string,
    lastMessageAt: string
  ): Promise<SupabaseResult<void>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_sessions')
      .update({ last_message_at: lastMessageAt })
      .eq('id', sessionId)
      .in('user_id', accessibleIds)
      .select('id');

    if (error) {
      return this.failure('チャットセッションの更新に失敗しました', {
        error,
        developerMessage: 'Failed to update last_message_at',
        context: { sessionId, userId },
      });
    }

    if (!data || data.length === 0) {
      return this.failure('セッションが見つからないか、更新権限がありません', {
        developerMessage: 'No rows updated',
        context: { sessionId, userId },
      });
    }

    return this.success(undefined);
  }

  async createChatMessage(message: DbChatMessage): Promise<SupabaseResult<string>> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .insert(message)
      .select('id')
      .single();

    if (error) {
      return this.failure('チャットメッセージの作成に失敗しました', {
        error,
        developerMessage: 'Failed to create chat message',
        context: { messageId: message.id, sessionId: message.session_id, userId: message.user_id },
      });
    }

    if (!data?.id) {
      return this.failure('チャットメッセージの作成に失敗しました', {
        developerMessage: 'Chat message insert returned no id',
        context: { message },
      });
    }

    return this.success(data.id);
  }

  async updateLastAssistantMessage(
    sessionId: string,
    userId: string,
    content: string,
    model: string | null
  ): Promise<SupabaseResult<void>> {
    const { data: msg, error: findError } = await this.supabase
      .from('chat_messages')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) {
      return this.failure('アシスタントメッセージの取得に失敗しました', {
        error: findError,
        developerMessage: 'Failed to find last assistant message',
        context: { sessionId, userId },
      });
    }

    if (!msg) {
      return this.failure('更新対象のアシスタントメッセージが見つかりません', {
        developerMessage: 'No assistant message found for session',
        context: { sessionId, userId },
      });
    }

    const { error: updateError } = await this.supabase
      .from('chat_messages')
      .update({ content, model })
      .eq('id', msg.id)
      .eq('user_id', userId);

    if (updateError) {
      return this.failure('アシスタントメッセージの更新に失敗しました', {
        error: updateError,
        developerMessage: 'Failed to update last assistant message',
        context: { messageId: msg.id, sessionId, userId },
      });
    }

    const { error: sessionUpdateError } = await this.supabase
      .from('chat_sessions')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId);

    if (sessionUpdateError) {
      return this.failure('セッション更新時刻の更新に失敗しました', {
        error: sessionUpdateError,
        developerMessage: 'Failed to update session last_message_at',
        context: { sessionId, userId },
      });
    }

    return this.success(undefined);
  }

  async getChatMessagesBySessionId(
    sessionId: string,
    userId: string
  ): Promise<SupabaseResult<DbChatMessage[]>> {
    // アクセス可能なユーザーIDを取得（オーナー/従業員の相互閲覧対応）
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { userId },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .in('user_id', accessibleIds) // オーナー/従業員の相互閲覧に対応
      .order('created_at', { ascending: true });

    if (error) {
      return this.failure('チャットメッセージの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get chat messages',
        context: { sessionId, userId },
      });
    }

    return this.success(data ?? []);
  }

  async getLatestChatMessageBySessionAndModel(
    sessionId: string,
    userId: string,
    model: string
  ): Promise<SupabaseResult<DbChatMessage | null>> {
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('model', model)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return this.failure('チャットメッセージの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get latest chat message by model',
        context: { sessionId, userId, model },
      });
    }

    return this.success(data ?? null);
  }

  /**
   * 指定モデル（プレフィックス一致）の最新 assistant メッセージを取得する。
   * blog_creation_step7 / blog_creation_step7_h0 等の両方にマッチさせたい場合に使用。
   */
  async getLatestChatMessageBySessionAndModelPrefix(
    sessionId: string,
    userId: string,
    modelPrefix: string
  ): Promise<SupabaseResult<DbChatMessage | null>> {
    const pattern = `${modelPrefix}%`;
    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .ilike('model', pattern)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return this.failure('チャットメッセージの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get latest chat message by model prefix',
        context: { sessionId, userId, modelPrefix },
      });
    }

    return this.success(data ?? null);
  }

  /**
   * セッション内でアクセス可能なユーザー範囲から、指定モデルの最新assistantメッセージを取得する。
   * オーナー/スタッフ共有アクセスに対応。
   */
  async getLatestAccessibleAssistantMessageBySessionAndModel(
    sessionId: string,
    userId: string,
    model: string
  ): Promise<SupabaseResult<DbChatMessage | null>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId, model },
      });
    }

    const { data, error } = await this.supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .in('user_id', accessibleIds)
      .eq('model', model)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return this.failure('チャットメッセージの取得に失敗しました', {
        error,
        developerMessage: 'Failed to get latest accessible assistant message by model',
        context: { sessionId, userId, model },
      });
    }

    return this.success(data ?? null);
  }

  /**
   * 指定したユーザーのメッセージ数を、時間範囲でカウント
   * role は 'user' のみを対象（送信回数としてカウントするため）
   */
  async countUserMessagesBetween(
    userId: string,
    fromIso: string,
    toIso: string
  ): Promise<SupabaseResult<number>> {
    const { count, error } = await this.supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', toIsoTimestamp(fromIso))
      .lt('created_at', toIsoTimestamp(toIso));

    if (error) {
      return this.failure('メッセージ数の取得に失敗しました', {
        error,
        developerMessage: 'Failed to count user messages in range',
        context: { userId, fromIso, toIso },
      });
    }

    return this.success(count ?? 0);
  }

  /**
   * wordpress_settingsテーブルからユーザーのWordPress設定を取得（セルフホスト対応版）
   */
  async getWordPressSettingsByUserId(userId: string): Promise<WordPressSettings | null> {
    const { data, error } = await this.supabase
      .from('wordpress_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch WordPress settings:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      wpType: data.wp_type as WordPressType,
      wpClientId: data.wp_client_id ?? undefined,
      wpClientSecret: data.wp_client_secret ?? undefined,
      wpSiteId: data.wp_site_id ?? undefined,
      wpSiteUrl: data.wp_site_url ?? undefined,
      wpUsername: data.wp_username ?? undefined,
      wpApplicationPassword: data.wp_application_password ?? undefined,
      wpAccessToken: data.wp_access_token ?? undefined,
      wpRefreshToken: data.wp_refresh_token ?? undefined,
      wpTokenExpiresAt: data.wp_token_expires_at ?? undefined,
      wpContentTypes: normalizeContentTypes(data.wp_content_types as string[] | null),
      createdAt: data.created_at ?? undefined,
      updatedAt: data.updated_at ?? undefined,
    };
  }

  /**
   * wordpress_settingsテーブルにユーザーのWordPress設定を挿入または更新 (Upsert) - WordPress.com用
   */
  async createOrUpdateWordPressSettings(
    userId: string,
    wpClientId: string,
    wpClientSecret: string,
    wpSiteId: string,
    options?: {
      wpContentTypes?: string[];
      accessToken?: string;
      refreshToken?: string;
      tokenExpiresAt?: string;
    }
  ): Promise<void> {
    const payload: Database['public']['Tables']['wordpress_settings']['Insert'] = {
      user_id: userId,
      wp_type: 'wordpress_com',
      wp_client_id: wpClientId,
      wp_client_secret: wpClientSecret, // 注意: 現状は平文で保存されます
      wp_site_id: wpSiteId,
      ...(options?.wpContentTypes && {
        wp_content_types: normalizeContentTypes(options.wpContentTypes) ?? [],
      }),
      wp_access_token: options?.accessToken ?? null,
      wp_refresh_token: options?.refreshToken ?? null,
      wp_token_expires_at: options?.tokenExpiresAt ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('wordpress_settings')
      .upsert(payload, {
        onConflict: 'user_id', // user_id が重複した場合は更新
      })
      .select(); // .select() はコメントの意図を尊重し残す

    if (error) {
      console.error('Error upserting WordPress.com settings:', error);
      throw new Error(`WordPress.com設定の保存または更新に失敗しました: ${error.message}`);
    }
  }

  /**
   * wordpress_settingsテーブルにユーザーのセルフホストWordPress設定を挿入または更新 (Upsert)
   */
  async createOrUpdateSelfHostedWordPressSettings(
    userId: string,
    wpSiteUrl: string,
    wpUsername: string,
    wpApplicationPassword: string,
    options?: { wpContentTypes?: string[] }
  ): Promise<void> {
    const payload: Database['public']['Tables']['wordpress_settings']['Insert'] = {
      user_id: userId,
      wp_type: 'self_hosted',
      wp_site_url: wpSiteUrl,
      wp_username: wpUsername,
      wp_application_password: wpApplicationPassword, // 注意: 現状は平文で保存されます
      ...(options?.wpContentTypes && {
        wp_content_types: normalizeContentTypes(options.wpContentTypes) ?? [],
      }),
      updated_at: new Date().toISOString(),
    };

    const { error } = await this.supabase
      .from('wordpress_settings')
      .upsert(payload, {
        onConflict: 'user_id', // user_id が重複した場合は更新
      })
      .select();

    if (error) {
      console.error('Error upserting self-hosted WordPress settings:', error);
      throw new Error(`セルフホストWordPress設定の保存または更新に失敗しました: ${error.message}`);
    }
  }

  async updateWordPressContentTypes(userId: string, wpContentTypes: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('wordpress_settings')
      .update({
        wp_content_types: normalizeContentTypes(wpContentTypes),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating WordPress content types:', error);
      throw new Error(`WordPress投稿タイプの更新に失敗しました: ${error.message}`);
    }
  }

  /**
   * WordPress.com アクセストークンをリフレッシュ
   */
  async refreshWpComToken(
    userId: string,
    wpSettings?: WordPressSettings
  ): Promise<
    | {
        success: true;
        accessToken: string;
        refreshToken?: string | null;
        expiresAt?: string | null;
      }
    | { success: false; error: string }
  > {
    const settings = wpSettings ?? (await this.getWordPressSettingsByUserId(userId));
    if (!settings || settings.wpType !== 'wordpress_com') {
      return { success: false, error: 'WordPress.com設定が見つかりません' };
    }
    const clientId = settings.wpClientId || process.env.WORDPRESS_COM_CLIENT_ID;
    const clientSecret = settings.wpClientSecret || process.env.WORDPRESS_COM_CLIENT_SECRET;
    const refreshToken = settings.wpRefreshToken;

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        success: false,
        error: 'クライアントID/シークレットまたはリフレッシュトークンが不足しています',
      };
    }

    try {
      const resp = await fetch('https://public-api.wordpress.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { success: false, error: `token refresh failed: ${resp.status} ${text}` };
      }

      const json = (await resp.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!json.access_token) {
        return { success: false, error: ERROR_MESSAGES.COMMON.TOKEN_REFRESH_ACCESS_MISSING };
      }

      const expiresAt =
        json.expires_in && Number.isFinite(json.expires_in)
          ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
          : null;

      await this.supabase
        .from('wordpress_settings')
        .update({
          wp_access_token: json.access_token,
          wp_refresh_token: json.refresh_token ?? refreshToken,
          wp_token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      return {
        success: true,
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt,
      };
    } catch (error) {
      console.error('[SupabaseService.refreshWpComToken] error', error);
      return { success: false, error: ERROR_MESSAGES.COMMON.TOKEN_REFRESH_REQUEST_FAILED };
    }
  }

  /**
   * Google Search Console 資格情報を取得
   */
  async getGscCredentialByUserId(userId: string): Promise<GscCredential | null> {
    const { data, error } = await this.supabase
      .from('gsc_credentials')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to fetch GSC credential:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      userId: data.user_id,
      googleAccountEmail: data.google_account_email,
      refreshToken: data.refresh_token,
      accessToken: data.access_token,
      accessTokenExpiresAt: data.access_token_expires_at,
      scope: Array.isArray(data.scope) ? (data.scope as string[]) : null,
      propertyUri: data.property_uri,
      propertyType: data.property_type as GscPropertyType | null,
      propertyDisplayName: data.property_display_name,
      permissionLevel: data.permission_level,
      verified: data.verified,
      lastSyncedAt: data.last_synced_at,
      ga4PropertyId: data.ga4_property_id,
      ga4PropertyName: data.ga4_property_name,
      ga4ConversionEvents: Array.isArray(data.ga4_conversion_events)
        ? (data.ga4_conversion_events as string[])
        : null,
      ga4ThresholdEngagementSec:
        typeof data.ga4_threshold_engagement_sec === 'number'
          ? data.ga4_threshold_engagement_sec
          : null,
      ga4ThresholdReadRate:
        typeof data.ga4_threshold_read_rate === 'number' ? data.ga4_threshold_read_rate : null,
      ga4LastSyncedAt: data.ga4_last_synced_at,
      createdAt: data.created_at ?? new Date().toISOString(),
      updatedAt: data.updated_at ?? new Date().toISOString(),
    };
  }

  /**
   * Google Ads 認証情報を保存
   */
  async saveGoogleAdsCredential(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken: string; // Google Ads API requires refresh token
      expiresIn?: number | undefined;
      scope?: string[] | undefined;
      googleAccountEmail?: string | null | undefined;
      managerCustomerId?: string | null | undefined;
    }
  ): Promise<SupabaseResult<void>> {
    const expiresAt = new Date();
    if (tokens.expiresIn) {
      expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expiresIn);
    } else {
      expiresAt.setHours(expiresAt.getHours() + 1);
    }

    const { error } = await this.supabase.from('google_ads_credentials').upsert(
      {
        user_id: userId,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        access_token_expires_at: expiresAt.toISOString(),
        google_account_email: tokens.googleAccountEmail ?? null,
        scope: tokens.scope || [],
        manager_customer_id: tokens.managerCustomerId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      return this.failure('Google Ads認証情報の保存に失敗しました', {
        error,
        developerMessage: 'Error upserting Google Ads credential',
        context: { userId },
      });
    }

    return this.success(undefined);
  }

  /**
   * Google Ads 資格情報を取得
   */
  async getGoogleAdsCredential(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    googleAccountEmail: string | null;
    scope: string[];
    customerId: string | null;
    managerCustomerId: string | null;  // MCC（マネージャー）アカウントID
  } | null> {
    const { data, error } = await this.supabase
      .from('google_ads_credentials')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching Google Ads credential:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: data.access_token_expires_at,
      googleAccountEmail: data.google_account_email,
      scope: data.scope || [],
      customerId: data.customer_id ?? null,
      managerCustomerId: data.manager_customer_id ?? null,  // MCC ID を追加
    };
  }

  private getGoogleAdsEvaluationClient(): SupabaseClient<ExtendedDatabase> {
    return this.supabase as unknown as SupabaseClient<ExtendedDatabase>;
  }

  private getGoogleAdsNegativeKeywordsSettingsClient(): SupabaseClient<ExtendedDatabase> {
    return this.supabase as unknown as SupabaseClient<ExtendedDatabase>;
  }

  private mapGoogleAdsEvaluationSettingsRow(
    row: GoogleAdsEvaluationSettingsTable['Row']
  ): GoogleAdsEvaluationSettingsRecord {
    return {
      userId: row.user_id,
      dateRangeDays: row.date_range_days,
      lastEvaluatedOn: row.last_evaluated_on,
    };
  }

  async getGoogleAdsEvaluationSettings(
    userId: string
  ): Promise<SupabaseResult<GoogleAdsEvaluationSettingsRecord | null>> {
    const client = this.getGoogleAdsEvaluationClient();
    const { data, error } = await client
      .from('google_ads_evaluation_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_FETCH_FAILED, {
        error,
        developerMessage: 'Error fetching Google Ads evaluation settings',
        context: { userId },
      });
    }

    return this.success(
      data ? this.mapGoogleAdsEvaluationSettingsRow(data) : null
    );
  }

  async upsertGoogleAdsEvaluationSettings(
    input: UpsertGoogleAdsEvaluationSettingsInput
  ): Promise<SupabaseResult<void>> {
    const client = this.getGoogleAdsEvaluationClient();
    const now = new Date().toISOString();
    const payload: GoogleAdsEvaluationSettingsTable['Insert'] = {
      user_id: input.userId,
      updated_at: now,
    };

    if (input.dateRangeDays !== undefined) {
      payload.date_range_days = input.dateRangeDays;
    }
    if (input.lastEvaluatedOn !== undefined) {
      payload.last_evaluated_on = input.lastEvaluatedOn;
    }

    const { error } = await client
      .from('google_ads_evaluation_settings')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_UPDATE_FAILED, {
        error,
        developerMessage: 'Error upserting Google Ads evaluation settings',
        context: { ...input },
      });
    }

    return this.success(undefined);
  }

  async updateGoogleAdsEvaluationSettings(
    userId: string,
    updates: GoogleAdsEvaluationSettingsTable['Update']
  ): Promise<SupabaseResult<void>> {
    const client = this.getGoogleAdsEvaluationClient();
    const { data, error } = await client
      .from('google_ads_evaluation_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_UPDATE_FAILED, {
        error,
        developerMessage: 'Error updating Google Ads evaluation settings',
        context: { userId, updates },
      });
    }

    if (!data) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_NOT_FOUND, {
        developerMessage: 'Google Ads evaluation settings row not found',
        context: { userId, updates },
      });
    }

    return this.success(undefined);
  }

  private mapGoogleAdsNegativeKeywordsSettingsRow(
    row: GoogleAdsNegativeKeywordsSettingsTable['Row']
  ): GoogleAdsNegativeKeywordsSuggestionSettingsRecord {
    return {
      userId: row.user_id,
      enabled: row.enabled,
      sendHourJst: row.send_hour_jst,
      lastSentOn: row.last_sent_on,
      lastSendError: row.last_send_error,
    };
  }

  async getGoogleAdsNegativeKeywordsSettings(
    userId: string
  ): Promise<SupabaseResult<GoogleAdsNegativeKeywordsSuggestionSettingsRecord | null>> {
    const client = this.getGoogleAdsNegativeKeywordsSettingsClient();
    const { data, error } = await client
      .from('google_ads_negative_keywords_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_FETCH_FAILED, {
        error,
        developerMessage: 'Error fetching Google Ads negative keywords settings',
        context: { userId },
      });
    }

    return this.success(data ? this.mapGoogleAdsNegativeKeywordsSettingsRow(data) : null);
  }

  async upsertGoogleAdsNegativeKeywordsSettings(
    input: UpsertGoogleAdsNegativeKeywordsSuggestionSettingsInput
  ): Promise<SupabaseResult<void>> {
    const client = this.getGoogleAdsNegativeKeywordsSettingsClient();
    const payload: GoogleAdsNegativeKeywordsSettingsTable['Insert'] = {
      user_id: input.userId,
      updated_at: new Date().toISOString(),
    };

    if (input.enabled !== undefined) {
      payload.enabled = input.enabled;
    }
    if (input.sendHourJst !== undefined) {
      payload.send_hour_jst = input.sendHourJst;
    }
    if (input.lastSentOn !== undefined) {
      payload.last_sent_on = input.lastSentOn;
    }
    if (input.lastSendError !== undefined) {
      payload.last_send_error = input.lastSendError;
    }

    const { error } = await client
      .from('google_ads_negative_keywords_settings')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED, {
        error,
        developerMessage: 'Error upserting Google Ads negative keywords settings',
        context: { ...input },
      });
    }

    return this.success(undefined);
  }

  async updateGoogleAdsNegativeKeywordsSettings(
    userId: string,
    updates: GoogleAdsNegativeKeywordsSettingsTable['Update']
  ): Promise<SupabaseResult<void>> {
    const client = this.getGoogleAdsNegativeKeywordsSettingsClient();
    const { data, error } = await client
      .from('google_ads_negative_keywords_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED, {
        error,
        developerMessage: 'Error updating Google Ads negative keywords settings',
        context: { userId, updates },
      });
    }

    if (!data) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_NOT_FOUND, {
        developerMessage: 'Google Ads negative keywords settings row not found',
        context: { userId, updates },
      });
    }

    return this.success(undefined);
  }

  async listDueGoogleAdsNegativeKeywordsSettings(
    sendHourJst: number,
    todayJst: string
  ): Promise<SupabaseResult<GoogleAdsNegativeKeywordsSuggestionSettingsRecord[]>> {
    const client = this.getGoogleAdsNegativeKeywordsSettingsClient();
    const { data, error } = await client
      .from('google_ads_negative_keywords_settings')
      .select('*')
      .eq('enabled', true)
      .eq('send_hour_jst', sendHourJst);

    if (error) {
      return this.failure(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_FETCH_FAILED, {
        error,
        developerMessage: 'Error listing due Google Ads negative keywords settings',
        context: { sendHourJst, todayJst },
      });
    }

    const rows = (data ?? [])
      .filter(row => row.last_sent_on !== todayJst)
      .map(row => this.mapGoogleAdsNegativeKeywordsSettingsRow(row));

    return this.success(rows);
  }

  async updateGoogleAdsCustomerId(
    userId: string,
    customerId: string,
    managerCustomerId?: string | null
  ): Promise<SupabaseResult<void>> {
    const { data, error } = await this.supabase
      .from('google_ads_credentials')
      .update({
        customer_id: customerId,
        manager_customer_id: managerCustomerId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) {
      return this.failure('Google AdsアカウントIDの更新に失敗しました', {
        error,
        developerMessage: 'Error updating Google Ads customer ID',
        context: { userId, customerId, managerCustomerId },
      });
    }

    if (!data) {
      return this.failure('Google AdsアカウントIDの更新に失敗しました', {
        developerMessage: 'Google Ads credential not found for customer ID update',
        context: { userId, customerId, managerCustomerId },
      });
    }

    return this.success(undefined);
  }

  /**
   * Google Search Console 資格情報を保存
   */
  async upsertGscCredential(
    userId: string,
    payload: {
      refreshToken: string;
      googleAccountEmail?: string | null;
      accessToken?: string | null;
      accessTokenExpiresAt?: string | null;
      scope?: string[] | null;
      propertyUri?: string | null;
      propertyType?: GscPropertyType | null;
      propertyDisplayName?: string | null;
      permissionLevel?: string | null;
      verified?: boolean | null;
      lastSyncedAt?: string | null;
      ga4PropertyId?: string | null;
      ga4PropertyName?: string | null;
      ga4ConversionEvents?: string[] | null;
      ga4ThresholdEngagementSec?: number | null;
      ga4ThresholdReadRate?: number | null;
      ga4LastSyncedAt?: string | null;
    }
  ): Promise<void> {
    const record: Database['public']['Tables']['gsc_credentials']['Insert'] = {
      user_id: userId,
      refresh_token: payload.refreshToken,
      google_account_email: payload.googleAccountEmail ?? null,
      access_token: payload.accessToken ?? null,
      access_token_expires_at: payload.accessTokenExpiresAt ?? null,
      scope: payload.scope ?? null,
      property_uri: payload.propertyUri ?? null,
      property_type: payload.propertyType ?? null,
      property_display_name: payload.propertyDisplayName ?? null,
      permission_level: payload.permissionLevel ?? null,
      verified: payload.verified ?? null,
      last_synced_at: payload.lastSyncedAt ?? null,
      updated_at: new Date().toISOString(),
    };

    if ('ga4PropertyId' in payload) {
      record.ga4_property_id = payload.ga4PropertyId ?? null;
    }
    if ('ga4PropertyName' in payload) {
      record.ga4_property_name = payload.ga4PropertyName ?? null;
    }
    if ('ga4ConversionEvents' in payload) {
      record.ga4_conversion_events = payload.ga4ConversionEvents ?? null;
    }
    if ('ga4ThresholdEngagementSec' in payload) {
      record.ga4_threshold_engagement_sec = payload.ga4ThresholdEngagementSec ?? null;
    }
    if ('ga4ThresholdReadRate' in payload) {
      record.ga4_threshold_read_rate = payload.ga4ThresholdReadRate ?? null;
    }
    if ('ga4LastSyncedAt' in payload) {
      record.ga4_last_synced_at = payload.ga4LastSyncedAt ?? null;
    }

    const { error } = await this.supabase
      .from('gsc_credentials')
      .upsert(record, { onConflict: 'user_id' })
      .select();

    if (error) {
      console.error('Error upserting GSC credential:', error);
      throw new Error(`Google Search Console資格情報の保存に失敗しました: ${error.message}`);
    }
  }

  /**
   * Google Search Console 資格情報を部分更新
   */
  async updateGscCredential(
    userId: string,
    updates: Partial<{
      googleAccountEmail: string | null;
      accessToken: string | null;
      accessTokenExpiresAt: string | null;
      scope: string[] | null;
      propertyUri: string | null;
      propertyType: GscPropertyType | null;
      propertyDisplayName: string | null;
      permissionLevel: string | null;
      verified: boolean | null;
      lastSyncedAt: string | null;
      ga4PropertyId: string | null;
      ga4PropertyName: string | null;
      ga4ConversionEvents: string[] | null;
      ga4ThresholdEngagementSec: number | null;
      ga4ThresholdReadRate: number | null;
      ga4LastSyncedAt: string | null;
    }>
  ): Promise<void> {
    const record: Partial<TablesUpdate<'gsc_credentials'>> = {
      updated_at: new Date().toISOString(),
    };

    if ('googleAccountEmail' in updates) {
      record.google_account_email = updates.googleAccountEmail ?? null;
    }
    if ('accessToken' in updates) {
      record.access_token = updates.accessToken ?? null;
    }
    if ('accessTokenExpiresAt' in updates) {
      record.access_token_expires_at = updates.accessTokenExpiresAt ?? null;
    }
    if ('scope' in updates) {
      record.scope = updates.scope ?? null;
    }
    if ('propertyUri' in updates) {
      record.property_uri = updates.propertyUri ?? null;
    }
    if ('propertyType' in updates) {
      record.property_type = updates.propertyType ?? null;
    }
    if ('propertyDisplayName' in updates) {
      record.property_display_name = updates.propertyDisplayName ?? null;
    }
    if ('permissionLevel' in updates) {
      record.permission_level = updates.permissionLevel ?? null;
    }
    if ('verified' in updates) {
      record.verified = updates.verified ?? null;
    }
    if ('lastSyncedAt' in updates) {
      record.last_synced_at = updates.lastSyncedAt ?? null;
    }
    if ('ga4PropertyId' in updates) {
      record.ga4_property_id = updates.ga4PropertyId ?? null;
    }
    if ('ga4PropertyName' in updates) {
      record.ga4_property_name = updates.ga4PropertyName ?? null;
    }
    if ('ga4ConversionEvents' in updates) {
      record.ga4_conversion_events = updates.ga4ConversionEvents ?? null;
    }
    if ('ga4ThresholdEngagementSec' in updates) {
      record.ga4_threshold_engagement_sec = updates.ga4ThresholdEngagementSec ?? null;
    }
    if ('ga4ThresholdReadRate' in updates) {
      record.ga4_threshold_read_rate = updates.ga4ThresholdReadRate ?? null;
    }
    if ('ga4LastSyncedAt' in updates) {
      record.ga4_last_synced_at = updates.ga4LastSyncedAt ?? null;
    }

    const { error } = await this.supabase
      .from('gsc_credentials')
      .update(record)
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating GSC credential:', error);
      throw new Error(`Google Search Console資格情報の更新に失敗しました: ${error.message}`);
    }
  }

  /**
   * Google Search Console 資格情報を削除
   */
  async deleteGscCredential(userId: string): Promise<void> {
    const { error } = await this.supabase.from('gsc_credentials').delete().eq('user_id', userId);

    if (error) {
      console.error('[SupabaseService] deleteGscCredential: エラー詳細', {
        userId,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorHint: error.hint,
        fullError: error,
      });
      throw new Error(`Google Search Console資格情報の削除に失敗しました: ${error.message}`);
    }
  }

  async upsertGa4PageMetricsDaily(
    rows: Array<{
      userId: string;
      propertyId: string;
      date: string;
      pagePath: string;
      normalizedPath: string;
      sessions: number;
      users: number;
      engagementTimeSec: number;
      bounceRate: number;
      cvEventCount: number;
      scroll90EventCount: number;
      searchClicks: number;
      impressions: number;
      ctr: number | null;
      isSampled: boolean;
      isPartial: boolean;
      importedAt: string;
    }>
  ): Promise<void> {
    if (!rows.length) return;

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const nowIso = new Date().toISOString();
      const payload = chunk.map(row => ({
        user_id: row.userId,
        property_id: row.propertyId,
        date: row.date,
        page_path: row.pagePath,
        sessions: row.sessions,
        users: row.users,
        engagement_time_sec: row.engagementTimeSec,
        bounce_rate: row.bounceRate,
        cv_event_count: row.cvEventCount,
        scroll_90_event_count: row.scroll90EventCount,
        search_clicks: row.searchClicks,
        impressions: row.impressions,
        ctr: row.ctr,
        is_sampled: row.isSampled,
        is_partial: row.isPartial,
        imported_at: row.importedAt,
        created_at: row.importedAt,
        updated_at: nowIso,
      }));

      const { error } = await this.supabase.from('ga4_page_metrics_daily').upsert(payload, {
        onConflict: 'user_id,property_id,date,normalized_path',
      });

      if (error) {
        const chunkIndex = Math.floor(i / chunkSize);
        const totalChunks = Math.ceil(rows.length / chunkSize);
        const samplePropertyId = chunk[0]?.propertyId ?? 'unknown';
        console.error('[SupabaseService] upsertGa4PageMetricsDaily failed', {
          chunkIndex,
          totalChunks,
          chunkSize: chunk.length,
          totalRows: rows.length,
          propertyId: samplePropertyId,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          errorHint: error.hint,
        });
        throw new Error(`GA4日次指標の保存に失敗しました: ${error.message}`);
      }
    }
  }

  async listGa4SyncTargets(limit: number): Promise<
    Array<{
      userId: string;
      propertyId: string;
      lastSyncedAt: string | null;
    }>
  > {
    const { data, error } = await this.supabase
      .from('gsc_credentials')
      .select('user_id, ga4_property_id, ga4_last_synced_at')
      .not('ga4_property_id', 'is', null)
      .order('ga4_last_synced_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (error) {
      console.error('Failed to list GA4 sync targets:', error);
      throw new Error(`GA4同期対象の取得に失敗しました: ${error.message}`);
    }

    return (data ?? [])
      .filter(row => row.ga4_property_id)
      .map(row => ({
        userId: row.user_id,
        propertyId: row.ga4_property_id as string,
        lastSyncedAt: row.ga4_last_synced_at ?? null,
      }));
  }

  /**
   * Google Ads 資格情報を削除
   */
  async deleteGoogleAdsCredential(userId: string): Promise<SupabaseResult<void>> {
    const { error } = await this.supabase
      .from('google_ads_credentials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[SupabaseService] deleteGoogleAdsCredential: エラー詳細', {
        userId,
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorHint: error.hint,
        fullError: error,
      });
      return this.failure('Google Ads資格情報の削除に失敗しました', {
        error,
        developerMessage: 'Error deleting Google Ads credential',
        context: { userId },
      });
    }

    return this.success(undefined);
  }

  async upsertGscQueryMetrics(
    rows: Array<{
      userId: string;
      propertyUri: string;
      propertyType: GscPropertyType;
      searchType: GscSearchType;
      date: string;
      url: string;
      normalizedUrl: string;
      query: string;
      queryNormalized: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
      contentAnnotationId?: string | null;
      importedAt: string;
    }>
  ): Promise<void> {
    if (!rows.length) {
      return;
    }

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const nowIso = new Date().toISOString();
      const payload = chunk.map(row => ({
        user_id: row.userId,
        property_uri: row.propertyUri,
        property_type: row.propertyType,
        search_type: row.searchType,
        date: row.date,
        url: row.url,
        normalized_url: row.normalizedUrl,
        query: row.query,
        query_normalized: row.queryNormalized,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        content_annotation_id: row.contentAnnotationId ?? null,
        imported_at: row.importedAt,
        created_at: row.importedAt,
        updated_at: nowIso,
      }));

      const { error } = await this.supabase.from('gsc_query_metrics').upsert(payload, {
        onConflict: 'user_id,property_uri,date,normalized_url,query_normalized,search_type',
      });

      if (error) {
        console.error('Error upserting GSC query metrics:', error);
        throw new Error(`Google Search Consoleクエリ指標の保存に失敗しました: ${error.message}`);
      }
    }
  }

  /**
   * 特定のアノテーションに関連付けられているが、現在の正規化URLとは異なるクエリ指標データを削除
   * URL変更時のデータ不整合（二重カウント）を解消するために使用
   */
  async cleanupOldGscQueryMetrics(
    annotationId: string,
    currentNormalizedUrl: string
  ): Promise<void> {
    const { error: queryError } = await this.supabase
      .from('gsc_query_metrics')
      .delete()
      .eq('content_annotation_id', annotationId)
      .neq('normalized_url', currentNormalizedUrl);

    if (queryError) {
      console.error('[SupabaseService] cleanupOldGscQueryMetrics failed:', queryError);
      throw new Error(
        `以前のURLのクエリ指標データのクリーンアップに失敗しました: ${queryError.message}`
      );
    }
  }

  async hasOldGscPageMetrics(annotationId: string, currentNormalizedUrl: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('gsc_page_metrics')
      .select('id', { count: 'exact', head: true })
      .eq('content_annotation_id', annotationId)
      .neq('normalized_url', currentNormalizedUrl);

    if (error) {
      throw new Error(`ページ指標データの確認に失敗しました: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  async hasOldGscQueryMetrics(
    annotationId: string,
    currentNormalizedUrl: string
  ): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('gsc_query_metrics')
      .select('id', { count: 'exact', head: true })
      .eq('content_annotation_id', annotationId)
      .neq('normalized_url', currentNormalizedUrl);

    if (error) {
      throw new Error(`クエリ指標データの確認に失敗しました: ${error.message}`);
    }

    return (count ?? 0) > 0;
  }

  /**
   * §17: 既存コンテンツ在庫（WordPress 由来の実在記事）を取得する。
   * カニバリ判定（新規 vs 修正）の材料として LLM へ渡す。
   * 本文はトークン肥大防止のため先頭抜粋のみ。直近更新の上位 limit 件に制限する。
   */
  async getContentInventoryByUserId(
    userId: string,
    limit = 50
  ): Promise<SupabaseResult<ContentInventoryItem[]>> {
    const selectColumns =
      'id, wp_post_title, canonical_url, normalized_url, main_kw, kw, wp_category_names, wp_content_text';

    // §17.4-C: KW狙いの記事（main_kw あり）を優先し、上限内でAIに見せる。
    // PostgREST は `ORDER BY (main_kw IS NULL)` のような式ソートを書けないため、
    // ①main_kw 非NULL を更新日降順で limit 件 → ②枠が余れば main_kw NULL を更新日降順で補充、
    // の2クエリで「あり優先・各群で更新日降順」を正確に表現する（文字列順カットの事故を防ぐ）。
    const keyed = await this.supabase
      .from('content_annotations')
      .select(selectColumns)
      .eq('user_id', userId)
      .not('wp_post_id', 'is', null)
      .not('main_kw', 'is', null)
      // updated_at は同一インポートバッチで同値が多発するため id を副キーにし、
      // 上限カットの境界がタイ内で非決定的にならない（落ちる記事が安定する）ようにする。
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (keyed.error) {
      return this.failure('既存コンテンツ在庫の取得に失敗しました', {
        error: keyed.error,
        developerMessage: 'Failed to fetch content inventory (keyed)',
        context: { userId },
      });
    }

    const rows: Array<{
      id: string;
      wp_post_title: string | null;
      canonical_url: string | null;
      normalized_url: string | null;
      main_kw: string | null;
      kw: string | null;
      wp_category_names: string[] | null;
      wp_content_text: string | null;
    }> = keyed.data ?? [];
    if (rows.length < limit) {
      const fill = await this.supabase
        .from('content_annotations')
        .select(selectColumns)
        .eq('user_id', userId)
        .not('wp_post_id', 'is', null)
        .is('main_kw', null)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit - rows.length);

      if (fill.error) {
        return this.failure('既存コンテンツ在庫の取得に失敗しました', {
          error: fill.error,
          developerMessage: 'Failed to fetch content inventory (fill)',
          context: { userId },
        });
      }

      rows.push(...(fill.data ?? []));
    }

    const items: ContentInventoryItem[] = rows.map(row => ({
      id: row.id,
      title: row.wp_post_title ?? '',
      url: row.canonical_url ?? row.normalized_url ?? '',
      mainKw: row.main_kw,
      kw: row.kw,
      categoryNames: row.wp_category_names ?? [],
      excerpt: (row.wp_content_text ?? '').slice(0, 200),
    }));

    return this.success(items);
  }

  /**
   * §17.4: メール記事リンク突合（コード側）専用の軽量な在庫取得。
   * プロンプトへは渡さずコードの突合インデックスにのみ使うため、本文抜粋・カテゴリは取得しない
   * （トークン非依存なので件数上限を広く取り、突合カバレッジを最大化する）。
   */
  async getContentInventoryForMatching(
    userId: string,
    options: { maxRows?: number } = {}
  ): Promise<SupabaseResult<ContentInventoryItem[]>> {
    // db-max-rows(1000) を超える記事数でも全件取得するため range ページングする。
    // count:'exact' で総件数を取得し確実に停止。並びは決定的（updated_at 同値は id でタイブレーク）。
    const { data, error, truncated } = await this.fetchAllPaged(
      (from, to) =>
        this.supabase
          .from('content_annotations')
          .select('id, wp_post_title, canonical_url, normalized_url, main_kw, kw', {
            count: 'exact',
          })
          .eq('user_id', userId)
          .not('wp_post_id', 'is', null)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      { pageSize: 1000, ...(options.maxRows !== undefined && { maxRows: options.maxRows }) }
    );

    if (error) {
      return this.failure('既存コンテンツ在庫（突合用）の取得に失敗しました', {
        error,
        developerMessage: 'Failed to fetch content inventory for matching',
        context: { userId },
      });
    }

    const items: ContentInventoryItem[] = data.map(row => ({
      id: row.id,
      title: row.wp_post_title ?? '',
      url: row.canonical_url ?? row.normalized_url ?? '',
      mainKw: row.main_kw,
      kw: row.kw,
      categoryNames: [],
      excerpt: '',
    }));

    // maxRows 上限を明示指定した場合のみ truncated が立つ（既定は全件取得＝漏れなし）。
    if (truncated) {
      console.warn('[SupabaseService] content inventory for matching truncated by maxRows ceiling', {
        userId,
        maxRows: options.maxRows,
        returned: items.length,
      });
    }

    return this.success(items);
  }

  /**
   * §17 補助: 既存コンテンツ在庫（WP由来の実在記事）が1件以上あるかを判定する。
   * 「コンテンツ戦略提案」カードの注意喚起用。本文等は転送せず count(head) のみで存在確認する。
   */
  async hasContentInventory(userId: string): Promise<SupabaseResult<boolean>> {
    const { count, error } = await this.supabase
      .from('content_annotations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('wp_post_id', 'is', null);

    if (error) {
      return this.failure('既存コンテンツ在庫の確認に失敗しました', {
        error,
        developerMessage: 'Failed to check content inventory existence',
        context: { userId },
      });
    }

    return this.success((count ?? 0) > 0);
  }

  /**
   * GSC プロパティURI を「取得失敗」と「未連携(null)」を区別して返す。
   * getGscCredentialByUserId は DB エラー時も null を返すため、障害を未連携と誤認しないようにする用途。
   * 鮮度判定・順位スナップショットの両経路で共用する。
   */
  private async resolveGscPropertyUri(userId: string): Promise<SupabaseResult<string | null>> {
    const { data, error } = await this.supabase
      .from('gsc_credentials')
      .select('property_uri')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return this.failure('GSC連携情報の取得に失敗しました', {
        error,
        developerMessage: 'Failed to resolve gsc property_uri',
        context: { userId },
      });
    }

    return this.success(data?.property_uri ?? null);
  }

  /**
   * §17 補助: GSC データの鮮度（最新取得日・経過日数・データ有無）を取得する。
   * 「コンテンツ戦略提案」カードで、順位データが古い/無い場合の注意喚起に使う。
   * 順位スナップショットと同じ propertyUri 解決を流用する軽量メソッド。
   */
  async getGscDataFreshness(userId: string): Promise<SupabaseResult<GscDataFreshness>> {
    // 取得失敗（DB障害等）を未連携と誤認しないよう、失敗はそのまま伝播する。
    const propertyResult = await this.resolveGscPropertyUri(userId);
    if (!propertyResult.success) {
      return propertyResult;
    }
    const propertyUri = propertyResult.data;
    if (!propertyUri) {
      return this.success({ hasData: false, latestDate: null, daysStale: null });
    }

    const { data: latest, error } = await this.supabase
      .from('gsc_query_metrics')
      .select('date')
      .eq('user_id', userId)
      .eq('property_uri', propertyUri)
      .eq('search_type', 'web')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return this.failure('GSCデータ鮮度の取得に失敗しました', {
        error,
        developerMessage: 'Failed to resolve gsc data freshness',
        context: { userId },
      });
    }

    if (!latest) {
      return this.success({ hasData: false, latestDate: null, daysStale: null });
    }

    // GSC の date は JST 基準のため、今日も JST で算出する（UTC だと JST 0〜9時に1日ずれる）。
    const latestMs = Date.parse(`${latest.date}T00:00:00Z`);
    const todayMs = Date.parse(`${formatJstDateISO(new Date())}T00:00:00Z`);
    const daysStale = Math.max(0, Math.floor((todayMs - latestMs) / 86_400_000));

    return this.success({ hasData: true, latestDate: latest.date, daysStale });
  }

  /**
   * §17: GSC 自社順位スナップショットを取得する。
   * 広告データと同じ分析対象期間（dateRangeDays）に窓を揃え、最新日から遡って集約する。
   * 最新日のみだと GSC のクエリ別データは日次でスパースなため、実際は上位でも順位行が欠落しやすい。
   * 集約（同一 query_normalized のインプレッション加重平均 position・合計指標、代表ページ解決）は
   * RPC get_gsc_ranking_snapshot に委譲し、DB側で窓内全行を対象に行う（事前の行キャップなし）。
   * 代表ページは (query, url) 単位の合計インプレッション最大のページ、URL/タイトルはその
   * content_annotation_id（FK）経由で解決する（URL文字列マッチではない）。
   */
  async getRankingSnapshotByUserId(
    userId: string,
    limit = 100,
    dateRangeDays = 1
  ): Promise<SupabaseResult<RankingSnapshotItem[]>> {
    // 1ユーザーが複数プロパティ・複数 search_type の指標を持ち得るため、
    // 順位の信頼性確保のためユーザーの GSC プロパティ + web 検索に絞り込む。
    // 取得失敗（DB障害等）を未連携と誤認しないよう、失敗はそのまま伝播する。
    const propertyResult = await this.resolveGscPropertyUri(userId);
    if (!propertyResult.success) {
      return propertyResult;
    }
    const propertyUri = propertyResult.data;
    if (!propertyUri) {
      return this.success([]);
    }

    const { data: latest, error: latestError } = await this.supabase
      .from('gsc_query_metrics')
      .select('date')
      .eq('user_id', userId)
      .eq('property_uri', propertyUri)
      .eq('search_type', 'web')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      return this.failure('検索順位スナップショットの取得に失敗しました', {
        error: latestError,
        developerMessage: 'Failed to resolve latest gsc_query_metrics date',
        context: { userId },
      });
    }

    if (!latest) {
      return this.success([]);
    }

    // 広告データと同じ分析対象期間に窓を揃える（startDate = 最新日 − (dateRangeDays − 1)）。
    const windowDays = Math.max(1, Math.floor(dateRangeDays));
    const startDateObj = new Date(`${latest.date}T00:00:00Z`);
    startDateObj.setUTCDate(startDateObj.getUTCDate() - (windowDays - 1));
    const startDate = startDateObj.toISOString().slice(0, 10);

    const { data, error } = await this.supabase.rpc('get_gsc_ranking_snapshot', {
      p_user_id: userId,
      p_property_uri: propertyUri,
      p_start_date: startDate,
      p_end_date: latest.date,
      p_limit: limit,
    });

    if (error) {
      return this.failure('検索順位スナップショットの取得に失敗しました', {
        error,
        developerMessage: 'Failed to fetch gsc ranking snapshot via RPC',
        context: { userId },
      });
    }

    const items: RankingSnapshotItem[] = (data ?? []).map(row => ({
      queryNormalized: row.query_normalized,
      position: row.position,
      impressions: row.impressions,
      clicks: row.clicks,
      url: row.url ?? '',
      title: row.title ?? '',
      contentAnnotationId: row.content_annotation_id,
    }));

    // 期間集約が効いているか／カバレッジを本番ログで確認できるようにする（秘密情報は出さない）。
    // saturated=true は集約後クエリ数が limit に張り付き、改善幅が頭打ちになっている可能性を示す。
    console.info('[SupabaseService] ranking snapshot aggregated', {
      dateRangeDays: windowDays,
      startDate,
      endDate: latest.date,
      rowCount: items.length,
      saturated: items.length >= limit,
    });

    return this.success(items);
  }

  /**
   * §17.4: メール記事リンクの「順位突合」を狙い撃ち取得する。
   * 指定クエリ（正規化済み）だけを統合RPC get_gsc_ranking_snapshot（p_queries 指定）で集約取得するため、取得上限が不要。
   * query_normalized はインポート時に normalizeQuery で生成され冪等のため、呼び出し側は
   * normalizeQuery(KW) を渡せばよい。広告データと同じ分析対象期間で窓を揃える。
   */
  async getRankingForQueries(
    userId: string,
    dateRangeDays: number,
    queries: string[]
  ): Promise<SupabaseResult<RankingSnapshotItem[]>> {
    if (queries.length === 0) {
      return this.success([]);
    }

    const propertyResult = await this.resolveGscPropertyUri(userId);
    if (!propertyResult.success) {
      return propertyResult;
    }
    const propertyUri = propertyResult.data;
    if (!propertyUri) {
      return this.success([]);
    }

    const { data: latest, error: latestError } = await this.supabase
      .from('gsc_query_metrics')
      .select('date')
      .eq('user_id', userId)
      .eq('property_uri', propertyUri)
      .eq('search_type', 'web')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      return this.failure('検索順位（狙い撃ち）の取得に失敗しました', {
        error: latestError,
        developerMessage: 'Failed to resolve latest gsc date for targeted ranking',
        context: { userId },
      });
    }

    if (!latest) {
      return this.success([]);
    }

    const windowDays = Math.max(1, Math.floor(dateRangeDays));
    const startDateObj = new Date(`${latest.date}T00:00:00Z`);
    startDateObj.setUTCDate(startDateObj.getUTCDate() - (windowDays - 1));
    const startDate = startDateObj.toISOString().slice(0, 10);

    // 統合RPC get_gsc_ranking_snapshot を p_queries 指定で呼ぶ＝狙い撃ち（p_limit 省略＝上限なし）。
    const { data, error } = await this.supabase.rpc('get_gsc_ranking_snapshot', {
      p_user_id: userId,
      p_property_uri: propertyUri,
      p_start_date: startDate,
      p_end_date: latest.date,
      p_queries: queries,
    });

    if (error) {
      return this.failure('検索順位（狙い撃ち）の取得に失敗しました', {
        error,
        developerMessage: 'Failed to fetch targeted gsc ranking via RPC',
        context: { userId },
      });
    }

    const items: RankingSnapshotItem[] = (data ?? []).map(row => ({
      queryNormalized: row.query_normalized,
      position: row.position,
      impressions: row.impressions,
      clicks: row.clicks,
      url: row.url ?? '',
      title: row.title ?? '',
      contentAnnotationId: row.content_annotation_id,
    }));

    return this.success(items);
  }

  /**
   * 特定のアノテーションに関連付けられているが、現在の正規化URLとは異なるページ指標データを削除
   * URL変更時のデータ不整合（二重カウント）を解消するために使用
   */
  async cleanupOldGscPageMetrics(
    annotationId: string,
    currentNormalizedUrl: string
  ): Promise<void> {
    const { error: pageError } = await this.supabase
      .from('gsc_page_metrics')
      .delete()
      .eq('content_annotation_id', annotationId)
      .neq('normalized_url', currentNormalizedUrl);

    if (pageError) {
      console.error('[SupabaseService] cleanupOldGscPageMetrics failed:', pageError);
      throw new Error(
        `以前のURLのページ指標データのクリーンアップに失敗しました: ${pageError.message}`
      );
    }
  }

  /**
   * チャットセッションとそれに紐づくすべてのメッセージ・コンテンツを削除
   */
  async deleteChatSession(sessionId: string, userId: string): Promise<SupabaseResult<void>> {
    const { data: accessibleIds, error: accessError } = await this.supabase.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return this.failure('アクセス権の確認に失敗しました', {
        error: accessError,
        developerMessage: 'Failed to get accessible user IDs',
        context: { sessionId, userId },
      });
    }

    // トランザクション的な削除を実行
    // 1. セッションに紐づくメッセージを削除
    const { error: messagesError } = await this.supabase
      .from('chat_messages')
      .delete()
      .eq('session_id', sessionId)
      .in('user_id', accessibleIds);

    if (messagesError) {
      return this.failure('チャットメッセージの削除に失敗しました', {
        error: messagesError,
        developerMessage: 'Failed to delete chat messages before session deletion',
        context: { sessionId, userId },
      });
    }

    // 2. セッションに紐づくコンテンツ注釈を削除
    const { error: annotationsError } = await this.supabase
      .from('content_annotations')
      .delete()
      .eq('session_id', sessionId)
      .in('user_id', accessibleIds);

    if (annotationsError) {
      return this.failure('コンテンツ注釈の削除に失敗しました', {
        error: annotationsError,
        developerMessage: 'Failed to delete content annotations before session deletion',
        context: { sessionId, userId },
      });
    }

    // 3. セッション自体を削除
    const { data: deletedSessions, error: sessionError } = await this.supabase
      .from('chat_sessions')
      .delete()
      .eq('id', sessionId)
      .in('user_id', accessibleIds)
      .select('id');

    if (sessionError) {
      return this.failure('チャットセッションの削除に失敗しました', {
        error: sessionError,
        developerMessage: 'Failed to delete chat session',
        context: { sessionId, userId },
      });
    }

    if (!deletedSessions || deletedSessions.length === 0) {
      return this.failure('チャットセッションが見つかりませんでした', {
        developerMessage: 'Chat session delete affected 0 rows',
        context: { sessionId, userId },
      });
    }

    return this.success(undefined);
  }

  /**
   * コンテンツ注釈を直接削除（孤立したコンテンツの削除用）
   */
  async deleteContentAnnotation(
    annotationId: string,
    userId: string
  ): Promise<SupabaseResult<void>> {
    const { error } = await this.supabase
      .from('content_annotations')
      .delete()
      .eq('id', annotationId)
      .eq('user_id', userId);

    if (error) {
      return this.failure('コンテンツの削除に失敗しました', {
        error,
        developerMessage: 'Failed to delete content annotation',
        context: { annotationId, userId },
      });
    }

    return this.success(undefined);
  }

  /* === 要件定義 (briefs) ===================================== */

  /**
   * 事業者情報を保存
   */
  async saveBrief(userId: string, data: Json): Promise<SupabaseResult<void>> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.rpc('upsert_brief', {
      p_user_id: userId,
      p_data: data,
      p_now: now,
    });

    if (error) {
      return this.failure('事業者情報の保存に失敗しました', {
        error,
        developerMessage: 'Failed to upsert brief',
        context: { userId },
      });
    }

    return this.success(undefined);
  }

  /**
   * 事業者情報を取得
   */
  async getBrief(userId: string): Promise<SupabaseResult<Record<string, unknown> | null>> {
    const { data, error } = await this.supabase
      .from('briefs')
      .select('data')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return this.failure('事業者情報の取得に失敗しました', {
        error,
        developerMessage: 'Failed to get brief',
        context: { userId },
      });
    }

    return this.success((data?.data as Record<string, unknown>) || null);
  }

  async deleteEmployeeAndRestoreOwner(
    employeeId: string,
    ownerId: string
  ): Promise<SupabaseResult<void>> {
    const { data, error } = await this.supabase
      .rpc('delete_employee_and_restore_owner', {
        p_employee_id: employeeId,
        p_owner_id: ownerId,
      })
      .returns<Array<{ success: boolean; error: string | null }>>()
      .single();

    if (error) {
      return this.failure('スタッフ削除とオーナー復帰に失敗しました', {
        error,
        context: { employeeId, ownerId },
      });
    }

    if (!data?.success) {
      return this.failure(data?.error ?? 'スタッフ削除とオーナー復帰に失敗しました', {
        error: new Error(data?.error ?? 'Failed to delete employee and restore owner'),
        context: { employeeId, ownerId },
      });
    }

    return this.success(undefined);
  }

  async deleteUserFully(userId: string): Promise<SupabaseResult<void>> {
    const { data, error } = await this.supabase
      .rpc('delete_user_fully', {
        p_user_id: userId,
      })
      .returns<Array<{ success: boolean; error: string | null }>>()
      .single();

    if (error) {
      return this.failure('ユーザーの完全削除に失敗しました', {
        error,
        context: { userId },
      });
    }

    if (!data?.success) {
      return this.failure(data?.error ?? 'ユーザーの完全削除に失敗しました', {
        error: new Error(data?.error ?? 'Failed to delete user fully'),
        context: { userId },
      });
    }

    return this.success(undefined);
  }

  async getEmployeeByOwnerId(ownerId: string): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('owner_user_id', ownerId)
      .maybeSingle();

    if (error) {
      return this.failure('スタッフの取得に失敗しました', { error });
    }
    return this.success(data ?? null);
  }
}
