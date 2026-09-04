import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatErrorCode } from '@/domain/errors/ChatError';

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  anthropicStream: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: mocks.anthropicCreate,
      stream: mocks.anthropicStream,
    };
  },
}));

vi.mock('openai', () => ({
  default: class {},
}));

vi.mock('@/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
  },
}));

import { llmChat } from '@/server/services/llmService';

describe('llmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('SDKのAbortをLLMタイムアウトとして返す', async () => {
    mocks.anthropicCreate.mockImplementation(
      (_params: unknown, options: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('Request was aborted.')),
            { once: true }
          );
        })
    );

    await expect(
      llmChat(
        'anthropic',
        'claude-sonnet-4-6',
        [{ role: 'user', content: 'test' }],
        { timeoutMs: 5 }
      )
    ).rejects.toMatchObject({ code: ChatErrorCode.CONNECTION_TIMEOUT });
  });
  /**
   * `thinking` は**未指定なら params に載せない**（`temperature` と同型）。
   * 無条件に載せると、明示していない18機能のリクエスト形まで変わる。
   */
  it('thinking を指定したときだけ Anthropic の params に載せる', async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await llmChat('anthropic', 'test-model', [{ role: 'user', content: 'test' }], {
      thinking: { type: 'disabled' },
    });
    expect(mocks.anthropicCreate.mock.calls[0]?.[0]).toMatchObject({
      thinking: { type: 'disabled' },
    });

    await llmChat('anthropic', 'test-model', [{ role: 'user', content: 'test' }]);
    expect(mocks.anthropicCreate.mock.calls[1]?.[0]).not.toHaveProperty('thinking');
  });

  /**
   * `maxRetries` も**未指定なら SDK へ渡さない**（`thinking` と同型）。渡してしまうと
   * SDK 既定（2回）に依存している他機能の再送挙動まで変わる。
   * 逆に `0` を指定した経路では、SDK が 429 を裏でバックオフ再送しないことをここで固定する。
   */
  it('maxRetries を指定したときだけ SDK のリクエストオプションに載せる', async () => {
    mocks.anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await llmChat('anthropic', 'test-model', [{ role: 'user', content: 'test' }], {
      maxRetries: 0,
    });
    expect(mocks.anthropicCreate.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });

    await llmChat('anthropic', 'test-model', [{ role: 'user', content: 'test' }]);
    expect(mocks.anthropicCreate.mock.calls[1]?.[1]).not.toHaveProperty('maxRetries');
  });

  it('stream 経路でも maxRetries を SDK のリクエストオプションに載せる', async () => {
    mocks.anthropicStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    });

    await llmChat('anthropic', 'test-model', [{ role: 'user', content: 'test' }], {
      stream: true,
      maxRetries: 0,
    });
    expect(mocks.anthropicStream.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
  });
});
