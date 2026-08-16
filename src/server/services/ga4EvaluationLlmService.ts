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
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
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

function parseStructuredResponse<T>(response: string, schema: z.ZodType<T>): T | null {
  const match = response.match(JSON_BLOCK_REGEX);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
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
    try {
      const response = await llmChat(
        request.provider,
        request.model,
        [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
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
