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
});
