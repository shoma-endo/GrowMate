import type { IsoTimestamp } from '@/lib/timestamps';
import { parseTimestampStrict } from '@/lib/timestamps';
import type { Database } from '@/types/database.types';

/**
 * チャットメッセージの型定義
 */
export interface ChatMessage {
  id: string; // メッセージID (自動生成)
  userId: string; // メッセージの送信者ID (ユーザーID)
  sessionId: string; // チャットセッションID
  role: ChatRole; // メッセージの役割 ('user'/'assistant'/'system')
  content: string; // メッセージの内容
  model?: string | undefined; // 使用されたAIモデル (assistantの場合)
  createdAt: IsoTimestamp; // 作成日時 (UTC ISO文字列)
}

/**
 * チャットセッションの型定義
 */
export interface ChatSession {
  id: string; // セッションID
  userId: string; // セッションの所有者ID
  title: string; // セッションのタイトル
  systemPrompt?: string | undefined; // システムプロンプト
  serviceId?: string | undefined; // サービスID
  lastMessageAt: IsoTimestamp; // 最後のメッセージ日時 (UTC ISO文字列)
  createdAt: IsoTimestamp; // 作成日時 (UTC ISO文字列)
}

export interface ChatResponse {
  message: string;
  error?: string | undefined;
  sessionId?: string | undefined;
  warning?: string | undefined;
  success?: false | undefined;
  emailLinkConflict?: true | undefined;
}

/**
 * チャットの役割
 */
export enum ChatRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

/**
 * チャットメッセージのデータベースモデル
 */
export type DbChatMessage = Database['public']['Tables']['chat_messages']['Row'];

/**
 * チャットセッションのデータベースモデル
 */
export type DbChatSession = Database['public']['Tables']['chat_sessions']['Row'];

/**
 * チャットセッション検索結果のデータベース行
 */
export interface DbChatSessionSearchRow {
  session_id: string;
  title: string;
  canonical_url?: string | null;
  wp_post_title?: string | null;
  last_message_at: IsoTimestamp;
  similarity_score: number;
}

/**
 * 検索APIが返す集約済みのチャットセッション情報
 */
export interface ChatSessionSearchMatch {
  sessionId: string;
  title: string;
  canonicalUrl: string | null;
  wordpressTitle: string | null;
  lastMessageAt: IsoTimestamp;
  similarityScore: number;
}

/**
 * アプリケーションモデルとデータベースモデル間の変換関数
 */
export function toChatMessage(dbMessage: DbChatMessage): ChatMessage {
  return {
    id: dbMessage.id,
    userId: dbMessage.user_id,
    sessionId: dbMessage.session_id,
    role: dbMessage.role as ChatRole,
    content: dbMessage.content,
    model: dbMessage.model ?? undefined,
    createdAt: parseTimestampStrict(dbMessage.created_at),
  };
}

export function toChatSession(dbSession: DbChatSession): ChatSession {
  return {
    id: dbSession.id,
    userId: dbSession.user_id,
    title: dbSession.title,
    systemPrompt: dbSession.system_prompt ?? undefined,
    serviceId: dbSession.service_id ?? undefined,
    lastMessageAt: parseTimestampStrict(dbSession.last_message_at),
    createdAt: parseTimestampStrict(dbSession.created_at),
  };
}

/**
 * OpenAI API用のメッセージ型
 */
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}


/**
 * Server Component用の簡潔なChatMessage型
 */
export interface ServerChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: IsoTimestamp;
}

/**
 * Server Component用のChatSession型（RPCでメッセージを含む）
 */
export interface ServerChatSession {
  id: string;
  title: string;
  last_message_at: IsoTimestamp;
  messages?: ServerChatMessage[]; // RPC で埋め込む
}
