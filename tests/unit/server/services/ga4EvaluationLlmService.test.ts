import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';

const mocks = vi.hoisted(() => ({ llmChat: vi.fn() }));

vi.mock('@/server/services/llmService', () => ({ llmChat: mocks.llmChat }));

import { generateGa4EvaluationLlmOutput } from '@/server/services/ga4EvaluationLlmService';

const schema = z.object({ score: z.number() });
const request = {
  provider: 'anthropic' as const,
  model: 'model-name',
  prompt: 'prompt-secret',
  schema,
  maxTokens: 1234,
};

describe('ga4EvaluationLlmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('jsonフェンスを抽出してZod検証し、timeoutMsとmaxTokensを明示する', async () => {
    mocks.llmChat.mockResolvedValue('```json\n{"score": 82}\n```');

    const result = await generateGa4EvaluationLlmOutput(request);

    expect(result).toEqual({ success: true, data: { score: 82 }, attemptCount: 1 });
    expect(mocks.llmChat).toHaveBeenCalledWith(
      'anthropic',
      'model-name',
      [{ role: 'user', content: 'prompt-secret' }],
      { timeoutMs: 45_000, maxTokens: 1234 }
    );
  });

  it('フェンスなしの前置き文から最初のJSONオブジェクトを抽出する', async () => {
    mocks.llmChat.mockResolvedValue('結果はこちらです。{"score": 82}');
    await expect(generateGa4EvaluationLlmOutput(request)).resolves.toEqual({
      success: true,
      data: { score: 82 },
      attemptCount: 1,
    });
  });

  it('ChatErrorの429とZod検証失敗を固定2秒間隔で最大3回再試行する', async () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    mocks.llmChat
      .mockRejectedValueOnce(
        new ChatError('rate limited', ChatErrorCode.ANTHROPIC_RATE_LIMIT, { httpStatus: 429 })
      )
      .mockResolvedValueOnce('```json\n{"score":"invalid"}\n```')
      .mockResolvedValueOnce('```json\n{"score": 82}\n```');

    const resultPromise = generateGa4EvaluationLlmOutput({
      ...request,
      onAttempt: async attemptCount => {
        attempts.push(attemptCount);
      },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data: { score: 82 }, attemptCount: 3 });
    expect(mocks.llmChat).toHaveBeenCalledTimes(3);
    expect(attempts).toEqual([1, 2, 3]);
  });

  it('ChatError.context.httpStatusの5xxを最大3回再試行する', async () => {
    vi.useFakeTimers();
    mocks.llmChat
      .mockRejectedValueOnce(
        new ChatError('service unavailable', ChatErrorCode.AI_SERVICE_ERROR, {
          httpStatus: 503,
        })
      )
      .mockResolvedValueOnce('```json\n{"score": 82}\n```');

    const resultPromise = generateGa4EvaluationLlmOutput(request);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data: { score: 82 }, attemptCount: 2 });
    expect(mocks.llmChat).toHaveBeenCalledTimes(2);
  });

  it('CONNECTION_TIMEOUTをllm_timeoutとして最大3回再試行する', async () => {
    vi.useFakeTimers();
    mocks.llmChat.mockRejectedValue(
      new ChatError('request timed out', ChatErrorCode.CONNECTION_TIMEOUT)
    );

    const resultPromise = generateGa4EvaluationLlmOutput(request);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await resultPromise;

    expect(result).toEqual({ success: false, code: 'llm_timeout', attemptCount: 3 });
    expect(mocks.llmChat).toHaveBeenCalledTimes(3);
  });

  it('3回失敗すると失敗コードを返し、通常ログへ機密値や応答全文を出さない', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.llmChat.mockResolvedValue('prompt-secret response');

    const resultPromise = generateGa4EvaluationLlmOutput(request);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await resultPromise;

    expect(result).toEqual({
      success: false,
      code: 'llm_output_invalid',
      attemptCount: 3,
    });
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('prompt-secret');
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('response');
  });
});
