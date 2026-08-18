import { z } from 'zod';

import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { llmChat } from '@/server/services/llmService';
import type { Ga4EvaluationErrorCode } from '@/types/ga4-evaluation';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const LLM_TIMEOUT_MS = 45_000;
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)\s*```/i;

export interface Ga4EvaluationLlmRequest<T> {
  provider: 'openai' | 'anthropic';
  model: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  onAttempt?: (attemptCount: number) => Promise<void>;
}

export type Ga4EvaluationLlmResult<T> =
  | { success: true; data: T; attemptCount: number }
  | {
      success: false;
      code: Ga4EvaluationErrorCode;
      attemptCount: number;
    };

function getHttpStatus(error: unknown): number | null {
  if (error instanceof ChatError) {
    const contextStatus = error.context?.httpStatus;
    if (typeof contextStatus === 'number') {
      return contextStatus;
    }
  }

  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  return typeof status === 'number' ? status : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === 'string') {
    return error.toLowerCase();
  }
  return '';
}

function classifyLlmError(error: unknown): {
  code: Ga4EvaluationErrorCode;
  retryable: boolean;
} {
  const status = getHttpStatus(error);
  const chatErrorCode = error instanceof ChatError ? error.code : null;
  if (chatErrorCode === ChatErrorCode.CONNECTION_TIMEOUT) {
    return { code: 'llm_timeout', retryable: true };
  }
  if (
    status === 429 ||
    chatErrorCode === ChatErrorCode.ANTHROPIC_RATE_LIMIT ||
    chatErrorCode === ChatErrorCode.RATE_LIMIT_EXCEEDED
  ) {
    return { code: 'llm_rate_limited', retryable: true };
  }
  if (
    (status !== null && status >= 500 && status <= 599) ||
    chatErrorCode === ChatErrorCode.ANTHROPIC_API_ERROR ||
    chatErrorCode === ChatErrorCode.ANTHROPIC_OVERLOADED
  ) {
    return { code: 'llm_server_error', retryable: true };
  }
  if (getErrorMessage(error).includes('timeout')) {
    return { code: 'llm_timeout', retryable: true };
  }
  return { code: 'unknown', retryable: false };
}

function findFirstJsonObject(response: string): string | null {
  const start = response.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < response.length; index += 1) {
    const character = response[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return response.slice(start, index + 1);
    }
  }
  return null;
}

function parseStructuredResponse<T>(response: string, schema: z.ZodType<T>): T | null {
  const match = response.match(JSON_BLOCK_REGEX);
  const jsonText = match?.[1]?.trim() || findFirstJsonObject(response);
  if (!jsonText) return null;
  try {
    const parsed: unknown = JSON.parse(jsonText);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function generateGa4EvaluationLlmOutput<T>(
  request: Ga4EvaluationLlmRequest<T>
): Promise<Ga4EvaluationLlmResult<T>> {
  let lastCode: Ga4EvaluationErrorCode = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await request.onAttempt?.(attempt);
    try {
      const response = await llmChat(
        request.provider,
        request.model,
        [{ role: 'user', content: request.prompt }],
        { timeoutMs: LLM_TIMEOUT_MS, maxTokens: request.maxTokens }
      );
      const parsed = parseStructuredResponse(response, request.schema);
      if (parsed !== null) {
        return { success: true, data: parsed, attemptCount: attempt };
      }
      lastCode = 'llm_output_invalid';
      console.error('[Ga4EvaluationLlm] structured output validation failed', {
        attempt,
        code: lastCode,
      });
    } catch (error) {
      const classified = classifyLlmError(error);
      lastCode = classified.code;
      console.error('[Ga4EvaluationLlm] request failed', {
        attempt,
        code: lastCode,
      });
      if (!classified.retryable) {
        return { success: false, code: lastCode, attemptCount: attempt };
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return { success: false, code: lastCode, attemptCount: MAX_ATTEMPTS };
}
