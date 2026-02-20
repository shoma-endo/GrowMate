import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { SupabaseClientManager } from '@/lib/client-manager';
import { parseTimestampSafe, toIsoTimestamp } from '@/lib/timestamps';
import type { Database, Json } from '@/types/database.types';
import {
  DbChatMessage,
  DbChatSession,
  DbChatSessionSearchRow,
  ServerChatMessage,
  ServerChatSession,
} from '@/types/chat';
import type { DbUser, EmployeeInvitation } from '@/types/user';
import type { UserRole } from '@/types/user';
import type { GscCredential, GscPropertyType, GscSearchType } from '@/types/gsc';
import { WordPressSettings, WordPressType } from '@/types/wordpress';
import { normalizeContentTypes } from '@/server/services/wordpressContentTypes';

export interface SupabaseErrorInfo {
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

  /**
   * ユーザープロフィールを保存または更新
   */
  async saveUserProfile(
    userId: string,
    lineProfile: { displayName: string; pictureUrl?: string; statusMessage?: string }
  ): Promise<SupabaseResult<unknown[]>> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .rpc('upsert_user_profile', {
        p_line_user_id: userId,
        p_line_display_name: lineProfile.displayName,
        p_line_picture_url: lineProfile.pictureUrl ?? null,
        p_line_status_message: lineProfile.statusMessage ?? null,
        p_now: now,
      })
      .returns<DbUser[]>();

    if (error) {
      return this.failure('ユーザープロフィールの保存に失敗しました', {
        error,
        developerMessage: 'Error saving user profile',
        context: { lineUserId: userId },
      });
    }

    return this.success(data ?? []);
  }

  /**
   * ユーザー情報をLINE IDで取得
   */
  async getUserByLineId(lineUserId: string): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('line_user_id', lineUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return this.failure('ユーザー情報の取得に失敗しました', {
        error,
        developerMessage: 'Error getting user by LINE ID',
        context: { lineUserId },
      });
    }

    return this.success(data ?? null);
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

  async getUserByStripeCustomerId(
    stripeCustomerId: string
  ): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の取得に失敗しました', {
        error,
        developerMessage: 'Error getting user by Stripe customer ID',
        context: { stripeCustomerId },
      });
    }

    return this.success(data ?? null);
  }

  async createUser(user: DbUser): Promise<SupabaseResult<DbUser>> {
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
    updates: Partial<DbUser>
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

  async updateUserByLineUserId(
    lineUserId: string,
    updates: Partial<DbUser>
  ): Promise<SupabaseResult<DbUser | null>> {
    const { data, error } = await this.supabase
      .from('users')
      .update(updates)
      .eq('line_user_id', lineUserId)
      .select('*')
      .maybeSingle();

    if (error) {
      return this.failure('ユーザー情報の更新に失敗しました', {
        error,
        developerMessage: 'Error updating user by LINE user ID',
        context: { lineUserId, updates },
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
        return { success: false, error: 'token refresh failed: access_token missing' };
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
      return { success: false, error: 'token refresh request failed' };
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

  /**
   * Google Ads の customer_id を更新
   * @param managerCustomerId - MCC（マネージャー）アカウントID（任意）
   * @returns 更新が成功した場合true、該当する行が存在しない場合false
   */
  async updateGoogleAdsCustomerId(
    userId: string,
    customerId: string,
    managerCustomerId?: string | null
  ): Promise<SupabaseResult<void>> {
    const updateData: {
      customer_id: string;
      updated_at: string;
      manager_customer_id?: string | null;
    } = {
      customer_id: customerId,
      updated_at: new Date().toISOString(),
    };

    // managerCustomerId が指定された場合は更新に含める
    if (managerCustomerId !== undefined) {
      updateData.manager_customer_id = managerCustomerId;
    }

    const { data, error } = await this.supabase
      .from('google_ads_credentials')
      .update(updateData)
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
      return this.failure('Google Ads認証情報が見つかりません', {
        developerMessage: 'No Google Ads credential found for user',
        context: { userId },
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
    const record: Record<string, unknown> = {
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

  /* === スタッフ招待機能 ================================ */

  async createEmployeeInvitation(
    invitation: Omit<EmployeeInvitation, 'id' | 'createdAt'>
  ): Promise<SupabaseResult<string>> {
    const { data, error } = await this.supabase
      .from('employee_invitations')
      .insert({
        owner_user_id: invitation.ownerUserId,
        invitation_token: invitation.invitationToken,
        expires_at: toIsoTimestamp(invitation.expiresAt),
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      return this.failure('招待の作成に失敗しました', { error });
    }
    return this.success(data.id);
  }

  async getEmployeeInvitationByToken(
    token: string
  ): Promise<SupabaseResult<EmployeeInvitation | null>> {
    const { data, error } = await this.supabase
      .from('employee_invitations')
      .select('*')
      .eq('invitation_token', token)
      .maybeSingle();

    if (error) {
      return this.failure('招待の取得に失敗しました', { error });
    }
    if (!data) return this.success(null);

    return this.success({
      id: data.id,
      ownerUserId: data.owner_user_id,
      invitationToken: data.invitation_token,
      expiresAt: parseTimestampSafe(data.expires_at),
      usedAt: data.used_at ? parseTimestampSafe(data.used_at) : undefined,
      usedByUserId: data.used_by_user_id ?? undefined,
      createdAt: parseTimestampSafe(data.created_at),
    });
  }

  async markInvitationAsUsed(token: string, userId: string): Promise<SupabaseResult<void>> {
    const { error } = await this.supabase
      .from('employee_invitations')
      .update({
        used_at: new Date().toISOString(),
        used_by_user_id: userId,
      })
      .eq('invitation_token', token);

    if (error) {
      return this.failure('招待の使用済更新に失敗しました', { error });
    }
    return this.success(undefined);
  }

  async acceptEmployeeInvitation(userId: string, token: string): Promise<SupabaseResult<void>> {
    const { data, error } = await this.supabase
      .rpc('accept_employee_invitation', {
        p_user_id: userId,
        p_token: token,
      })
      .returns<Array<{ success: boolean; error: string | null }>>()
      .single();

    if (error) {
      return this.failure('招待の受諾に失敗しました', { error, context: { userId } });
    }

    if (!data?.success) {
      return this.failure(data?.error ?? '招待の受諾に失敗しました', {
        error: new Error(data?.error ?? 'Failed to accept employee invitation'),
        context: { userId },
      });
    }

    return this.success(undefined);
  }

  async deleteEmployeeInvitation(id: string): Promise<SupabaseResult<void>> {
    const { error } = await this.supabase.from('employee_invitations').delete().eq('id', id);

    if (error) {
      return this.failure('招待の削除に失敗しました', { error });
    }
    return this.success(undefined);
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

  async getEmployeeInvitationByOwnerId(
    ownerId: string
  ): Promise<SupabaseResult<EmployeeInvitation | null>> {
    const { data, error } = await this.supabase
      .from('employee_invitations')
      .select('*')
      .eq('owner_user_id', ownerId)
      .maybeSingle();

    if (error) {
      return this.failure('招待の取得に失敗しました', { error });
    }
    if (!data) return this.success(null);

    return this.success({
      id: data.id,
      ownerUserId: data.owner_user_id,
      invitationToken: data.invitation_token,
      expiresAt: parseTimestampSafe(data.expires_at),
      usedAt: data.used_at ? parseTimestampSafe(data.used_at) : undefined,
      usedByUserId: data.used_by_user_id ?? undefined,
      createdAt: parseTimestampSafe(data.created_at),
    });
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
