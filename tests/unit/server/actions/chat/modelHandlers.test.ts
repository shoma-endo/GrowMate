import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  llmChat: vi.fn(),
  startChat: vi.fn(),
  continueChat: vi.fn(),
}));

vi.mock('@/server/services/llmService', () => ({ llmChat: mocks.llmChat }));
vi.mock('@/server/services/chatService', () => ({
  chatService: { startChat: mocks.startChat, continueChat: mocks.continueChat },
}));
vi.mock('@/lib/prompts', () => ({ getSystemPrompt: vi.fn().mockResolvedValue('system') }));
vi.mock('@/server/services/briefService', () => ({ briefService: {} }));
vi.mock('@/server/services/promptService', () => ({ PromptService: {} }));
vi.mock('@/lib/knowledgeInjection', () => ({ resolveKnowledgeBlocksForRequest: vi.fn() }));

import { ModelHandlerService } from '@/server/actions/chat/modelHandlers';
import { MODEL_CONFIGS } from '@/lib/constants';

const KEYWORD_MODEL_KEY = 'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2';

describe('ModelHandlerService キーワード選定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.llmChat.mockResolvedValue('【今すぐ客キーワード】\nA\n【後から客キーワード】\nB');
    mocks.startChat.mockResolvedValue({ message: 'ok' });
    mocks.continueChat.mockResolvedValue({ message: 'ok' });
  });

  /** キーは提供終了した微調整モデルの ID なので、API へはキーではなく actualModel を渡す */
  it('開始時も継続時もモデルキーではなく actualModel で OpenAI を呼ぶ', async () => {
    const handler = new ModelHandlerService();

    await handler.handleStart('user-1', { userMessage: 'A\nB', model: KEYWORD_MODEL_KEY }, 'paid');
    await handler.handleContinue(
      'user-1',
      { sessionId: 's-1', messages: [], userMessage: 'A\nB', model: KEYWORD_MODEL_KEY },
      'paid'
    );

    const expectedModel = MODEL_CONFIGS[KEYWORD_MODEL_KEY]!.actualModel;
    expect(expectedModel).not.toBe(KEYWORD_MODEL_KEY);
    expect(mocks.llmChat).toHaveBeenCalledTimes(2);
    for (const call of mocks.llmChat.mock.calls) {
      expect(call[0]).toBe('openai');
      expect(call[1]).toBe(expectedModel);
    }
  });
});
