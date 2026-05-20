import { DomainError } from './BaseError';

export enum ChatErrorCode {
  // ネットワークエラー
  NETWORK_ERROR = 'CHAT_NETWORK_ERROR',
  CONNECTION_TIMEOUT = 'CHAT_CONNECTION_TIMEOUT',

  // 認証エラー
  AUTHENTICATION_FAILED = 'CHAT_AUTH_FAILED',
  TOKEN_EXPIRED = 'CHAT_TOKEN_EXPIRED',

  // メッセージエラー
  VALIDATION_ERROR = 'CHAT_VALIDATION_ERROR',
  INVALID_MESSAGE = 'CHAT_INVALID_MESSAGE',
  MESSAGE_TOO_LONG = 'CHAT_MESSAGE_TOO_LONG',
  RATE_LIMIT_EXCEEDED = 'CHAT_RATE_LIMIT',

  // セッションエラー
  SESSION_NOT_FOUND = 'CHAT_SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'CHAT_SESSION_EXPIRED',
  SESSION_CREATION_FAILED = 'CHAT_SESSION_CREATION_FAILED',
  SESSION_LOAD_FAILED = 'CHAT_SESSION_LOAD_FAILED',
  SESSION_DELETE_FAILED = 'CHAT_SESSION_DELETE_FAILED',
  SESSION_UPDATE_FAILED = 'CHAT_SESSION_UPDATE_FAILED',

  // メッセージ送信エラー
  MESSAGE_SEND_FAILED = 'CHAT_MESSAGE_SEND_FAILED',
  MESSAGE_LOAD_FAILED = 'CHAT_MESSAGE_LOAD_FAILED',

  // AI関連エラー
  AI_SERVICE_ERROR = 'CHAT_AI_SERVICE_ERROR',
  MODEL_NOT_AVAILABLE = 'CHAT_MODEL_NOT_AVAILABLE',

  // Anthropic HTTPエラー（詳細区別）
  ANTHROPIC_INVALID_REQUEST = 'ANTHROPIC_INVALID_REQUEST', // 400
  ANTHROPIC_AUTHENTICATION_ERROR = 'ANTHROPIC_AUTHENTICATION_ERROR', // 401
  ANTHROPIC_PERMISSION_ERROR = 'ANTHROPIC_PERMISSION_ERROR', // 403
  ANTHROPIC_NOT_FOUND = 'ANTHROPIC_NOT_FOUND', // 404
  ANTHROPIC_REQUEST_TOO_LARGE = 'ANTHROPIC_REQUEST_TOO_LARGE', // 413
  ANTHROPIC_RATE_LIMIT = 'ANTHROPIC_RATE_LIMIT', // 429
  ANTHROPIC_API_ERROR = 'ANTHROPIC_API_ERROR', // 500
  ANTHROPIC_OVERLOADED = 'ANTHROPIC_OVERLOADED', // 529

  // 一般的なエラー
  UNKNOWN_ERROR = 'CHAT_UNKNOWN_ERROR',
}

export class ChatError extends DomainError {
  constructor(message: string, code: ChatErrorCode, context?: Record<string, unknown>) {
    const userMessage = ChatError.getUserMessage(code);
    super(message, code, userMessage, context);
  }

  private static getUserMessage(code: ChatErrorCode): string {
    const messages: Record<ChatErrorCode, string> = {
      [ChatErrorCode.NETWORK_ERROR]: 'ネットワークエラーが発生しました。接続環境をご確認ください。',
      [ChatErrorCode.CONNECTION_TIMEOUT]: 'AI通信でタイムアウトしました。再度お試しください。',
      [ChatErrorCode.AUTHENTICATION_FAILED]: 'ログインが必要です。再度ログインしてください。',
      [ChatErrorCode.TOKEN_EXPIRED]: 'セッションが期限切れです。再ログインしてください。',
      [ChatErrorCode.VALIDATION_ERROR]: 'メッセージの検証に失敗しました。',
      [ChatErrorCode.INVALID_MESSAGE]: 'メッセージの形式が正しくありません。',
      [ChatErrorCode.MESSAGE_TOO_LONG]: 'メッセージが長すぎます。4000文字以内で入力してください。',
      [ChatErrorCode.RATE_LIMIT_EXCEEDED]:
        '送信回数が制限を超えています。しばらくしてから再度お試しください。',
      [ChatErrorCode.SESSION_NOT_FOUND]: 'チャットセッションが見つかりません。',
      [ChatErrorCode.SESSION_EXPIRED]:
        'チャットセッションが期限切れです。新しいチャットを開始してください。',
      [ChatErrorCode.SESSION_CREATION_FAILED]: 'チャットセッションの作成に失敗しました。',
      [ChatErrorCode.SESSION_LOAD_FAILED]: 'チャットセッションの読み込みに失敗しました。',
      [ChatErrorCode.SESSION_DELETE_FAILED]: 'チャットセッションの削除に失敗しました。',
      [ChatErrorCode.SESSION_UPDATE_FAILED]: 'チャットセッションの更新に失敗しました。',
      [ChatErrorCode.MESSAGE_SEND_FAILED]: 'メッセージの送信に失敗しました。',
      [ChatErrorCode.MESSAGE_LOAD_FAILED]: 'メッセージの読み込みに失敗しました。',
      [ChatErrorCode.AI_SERVICE_ERROR]:
        'AIサービスに問題が発生しています。しばらくしてから再度お試しください。',
      [ChatErrorCode.MODEL_NOT_AVAILABLE]:
        '選択されたAIモデルが利用できません。他のモデルをお試しください。',
      // Anthropic HTTPエラー詳細
      [ChatErrorCode.ANTHROPIC_INVALID_REQUEST]:
        'リクエストが不正です（400）。内容・形式を確認してください。',
      [ChatErrorCode.ANTHROPIC_AUTHENTICATION_ERROR]:
        'Anthropic認証に失敗しました（401）。APIキーを確認してください。',
      [ChatErrorCode.ANTHROPIC_PERMISSION_ERROR]:
        '権限がありません（403）。利用可能なリソースか権限設定を確認してください。',
      [ChatErrorCode.ANTHROPIC_NOT_FOUND]:
        '指定のリソースが見つかりません（404）。モデル名などを確認してください。',
      [ChatErrorCode.ANTHROPIC_REQUEST_TOO_LARGE]:
        'リクエストサイズが上限を超えています（413）。入力サイズを削減してください。',
      [ChatErrorCode.ANTHROPIC_RATE_LIMIT]:
        'AIの利用が集中しています。しばらく待ってから、もう一度お試しください。',
      [ChatErrorCode.ANTHROPIC_API_ERROR]:
        'AIサービスで一時的な障害が発生しました。時間を置いてから、もう一度お試しください。',
      [ChatErrorCode.ANTHROPIC_OVERLOADED]:
        'AIサーバーが混雑しています。1〜2分ほど待ってから、もう一度お試しください。',
      [ChatErrorCode.UNKNOWN_ERROR]:
        '予期せぬエラーが発生しました。サポートにお問い合わせください。',
    };

    return messages[code] || messages[ChatErrorCode.UNKNOWN_ERROR];
  }

  /**
   * AnthropicのHTTPステータスコードをChatErrorCodeへ変換
   * 参考: https://docs.anthropic.com/en/api/errors
   */
  static anthropicStatusToCode(status: number): ChatErrorCode {
    switch (status) {
      case 400:
        return ChatErrorCode.ANTHROPIC_INVALID_REQUEST;
      case 401:
        return ChatErrorCode.ANTHROPIC_AUTHENTICATION_ERROR;
      case 403:
        return ChatErrorCode.ANTHROPIC_PERMISSION_ERROR;
      case 404:
        return ChatErrorCode.ANTHROPIC_NOT_FOUND;
      case 413:
        return ChatErrorCode.ANTHROPIC_REQUEST_TOO_LARGE;
      case 429:
        return ChatErrorCode.ANTHROPIC_RATE_LIMIT;
      case 500:
        return ChatErrorCode.ANTHROPIC_API_ERROR;
      case 529:
        return ChatErrorCode.ANTHROPIC_OVERLOADED;
      default:
        return ChatErrorCode.AI_SERVICE_ERROR;
    }
  }

  /**
   * 例外オブジェクトからHTTPステータスっぽい値を推測
   */
  /**
   * Anthropic SDK / SSE エラーから error.type を抽出する
   */
  static extractAnthropicErrorType(error: unknown): string | undefined {
    const e = error as
      | {
          error?: { type?: unknown };
          type?: unknown;
        }
      | undefined;

    const nestedType = e?.error?.type;
    if (typeof nestedType === 'string' && nestedType.length > 0) {
      return nestedType;
    }

    const topLevelType = e?.type;
    if (typeof topLevelType === 'string' && topLevelType.length > 0) {
      return topLevelType;
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : undefined;

    if (!message) return undefined;

    if (message.includes('overloaded_error')) return 'overloaded_error';
    if (message.includes('rate_limit_error')) return 'rate_limit_error';
    if (message.includes('api_error')) return 'api_error';
    if (message.includes('invalid_request_error')) return 'invalid_request_error';
    if (message.includes('authentication_error')) return 'authentication_error';
    if (message.includes('permission_error')) return 'permission_error';
    if (message.includes('not_found_error')) return 'not_found_error';
    if (message.includes('request_too_large')) return 'request_too_large';

    return undefined;
  }

  static anthropicErrorTypeToCode(type: string): ChatErrorCode | undefined {
    switch (type) {
      case 'overloaded_error':
        return ChatErrorCode.ANTHROPIC_OVERLOADED;
      case 'rate_limit_error':
        return ChatErrorCode.ANTHROPIC_RATE_LIMIT;
      case 'api_error':
        return ChatErrorCode.ANTHROPIC_API_ERROR;
      case 'invalid_request_error':
        return ChatErrorCode.ANTHROPIC_INVALID_REQUEST;
      case 'authentication_error':
        return ChatErrorCode.ANTHROPIC_AUTHENTICATION_ERROR;
      case 'permission_error':
        return ChatErrorCode.ANTHROPIC_PERMISSION_ERROR;
      case 'not_found_error':
        return ChatErrorCode.ANTHROPIC_NOT_FOUND;
      case 'request_too_large':
        return ChatErrorCode.ANTHROPIC_REQUEST_TOO_LARGE;
      default:
        return undefined;
    }
  }

  static extractHttpStatus(error: unknown): number | undefined {
    const e = error as Record<string, unknown> | undefined;
    const candidates = [
      (e as { status?: unknown })?.status,
      (e as { statusCode?: unknown })?.statusCode,
      (e as { response?: { status?: unknown } })?.response?.status,
      (e as { cause?: { status?: unknown; response?: { status?: unknown } } })?.cause?.status,
      (e as { cause?: { status?: unknown; response?: { status?: unknown } } })?.cause?.response
        ?.status,
    ].filter((v: unknown) => typeof v === 'number');
    if (candidates.length > 0) return candidates[0] as number;

    const msg: string | undefined =
      typeof (e as { message?: unknown })?.message === 'string'
        ? ((e as { message?: string }).message as string)
        : undefined;
    if (msg) {
      // メッセージに含まれる代表的なコードを走査
      if (msg.includes('429')) return 429;
      if (msg.includes('413')) return 413;
      if (msg.includes('401')) return 401;
      if (msg.includes('403')) return 403;
      if (msg.includes('404')) return 404;
      if (msg.includes('400')) return 400;
      if (msg.includes('500')) return 500;
      if (msg.includes('529')) return 529;
      if (msg.includes('overloaded_error')) return 529;
    }
    return undefined;
  }

  static fromApiError(error: unknown, context?: Record<string, unknown>): ChatError {
    if (error instanceof ChatError) {
      return error;
    }

    if (error instanceof Error) {
      // エラーメッセージからコードを推測
      const message = error.message.toLowerCase();

      if (message.includes('network') || message.includes('fetch')) {
        return new ChatError(error.message, ChatErrorCode.NETWORK_ERROR, context);
      }

      if (message.includes('timeout')) {
        return new ChatError(error.message, ChatErrorCode.CONNECTION_TIMEOUT, context);
      }

      if (message.includes('auth')) {
        return new ChatError(error.message, ChatErrorCode.AUTHENTICATION_FAILED, context);
      }

      const anthropicErrorType = ChatError.extractAnthropicErrorType(error);
      if (anthropicErrorType) {
        const code = ChatError.anthropicErrorTypeToCode(anthropicErrorType);
        if (code) {
          return new ChatError(error.message, code, {
            anthropicErrorType,
            ...context,
          });
        }
        // 未知の error.type は HTTP ステータスマッピングへフォールバック
      }

      // HTTPステータスに応じたAnthropicエラーの推測
      const status = ChatError.extractHttpStatus(error);
      if (status) {
        const code = ChatError.anthropicStatusToCode(status);
        return new ChatError(error.message, code, { httpStatus: status, ...context });
      }
      return new ChatError(error.message, ChatErrorCode.UNKNOWN_ERROR, context);
    }

    return new ChatError('Unknown error occurred', ChatErrorCode.UNKNOWN_ERROR, {
      originalError: error,
      ...context,
    });
  }
}
