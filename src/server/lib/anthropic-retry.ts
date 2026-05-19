import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';

export const ANTHROPIC_RETRY_MAX_ATTEMPTS = 3;
export const ANTHROPIC_RETRY_BASE_DELAY_MS = 2000;

export const ANTHROPIC_RETRY_USER_MESSAGE =
  'AIサーバーが混雑しています。自動で再試行しています…';

export interface AnthropicRetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  message: string;
}

export interface AnthropicRetryOptions {
  maxAttempts?: number;
  signal?: AbortSignal;
  onRetry?: (info: AnthropicRetryInfo) => void;
}

export function isRetryableAnthropicError(error: unknown): boolean {
  const code = ChatError.fromApiError(error).code;
  return (
    code === ChatErrorCode.ANTHROPIC_OVERLOADED ||
    code === ChatErrorCode.ANTHROPIC_API_ERROR ||
    code === ChatErrorCode.ANTHROPIC_RATE_LIMIT
  );
}

export function getAnthropicRetryDelayMs(attempt: number): number {
  return ANTHROPIC_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Anthropic API の一時障害（529/overloaded 等）向けに指数バックオフで再試行する。
 */
export async function withAnthropicRetry<T>(
  operation: () => Promise<T>,
  options?: AnthropicRetryOptions
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? ANTHROPIC_RETRY_MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.signal?.aborted) {
      throw createAbortError();
    }

    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const canRetry = isRetryableAnthropicError(error) && attempt < maxAttempts;
      if (!canRetry) {
        throw error;
      }

      const delayMs = getAnthropicRetryDelayMs(attempt);
      options?.onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        message: `${ANTHROPIC_RETRY_USER_MESSAGE}（${attempt + 1}/${maxAttempts}）`,
      });
      await sleep(delayMs, options?.signal);
    }
  }

  throw lastError;
}
