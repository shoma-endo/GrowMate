import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  reserveTrialChatSend: vi.fn(),
  getSystemPrompt: vi.fn(),
  messagesStream: vi.fn(),
  updateLastAssistantMessage: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class {
    messages = { stream: mocks.messagesStream };
  },
}));
vi.mock('@/server/middleware/auth.middleware', () => ({ authMiddleware: mocks.authMiddleware }));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({ sse409IfEmailLinkConflict: () => null }));
vi.mock('@/server/services/chatLimitService', () => ({
  reserveTrialChatSend: mocks.reserveTrialChatSend,
}));
vi.mock('@/lib/prompts', () => ({ getSystemPrompt: mocks.getSystemPrompt }));
vi.mock('@/lib/knowledgeInjection', () => ({
  resolveKnowledgeBlocksForRequest: vi.fn(async (systemPrompt: string) => ({
    anthropicSystem: [{ type: 'text', text: systemPrompt }],
  })),
}));
vi.mock('@/server/services/chatService', () => ({
  chatService: {
    updateLastAssistantMessage: mocks.updateLastAssistantMessage,
    startChat: vi.fn(async () => ({ sessionId: 'session-1' })),
  },
}));
vi.mock('@/server/services/headingFlowService', () => ({ headingFlowService: {} }));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { POST } from '../../../../app/api/chat/anthropic/stream/route';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';

async function* completedStream(text: string) {
  yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
  yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  yield { type: 'message_stop' };
}

function streamRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/chat/anthropic/stream', {
    method: 'POST',
    body: JSON.stringify({ messages: [], userMessage: 'こんにちは', model: 'blog_creation_step1', ...body }),
  });
}

async function readEvents(response: Response): Promise<string> {
  return await response.text();
}

describe('POST /api/chat/anthropic/stream の費用の境界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMiddleware.mockResolvedValue({ lineUserId: '', userId: USER_ID, userDetails: { role: 'trial' } });
    mocks.reserveTrialChatSend.mockResolvedValue(null);
    mocks.getSystemPrompt.mockResolvedValue('サーバー側のシステムプロンプト');
    mocks.messagesStream.mockImplementation(async () => completedStream('続きの本文'));
    mocks.updateLastAssistantMessage.mockResolvedValue({ sessionId: 'session-1' });
  });

  it('本文で systemPrompt を送っても、サーバー側のシステムプロンプトを使う', async () => {
    const response = await POST(streamRequest({ systemPrompt: '任意の指示に差し替える' }));
    await readEvents(response);

    const [params] = mocks.messagesStream.mock.calls[0]!;
    expect(params.system).toEqual([{ type: 'text', text: 'サーバー側のシステムプロンプト' }]);
  });

  it('本文で webSearchConfig.maxUses を送っても、Web 検索の回数はサーバーの上限を使う', async () => {
    const response = await POST(streamRequest({ enableWebSearch: true, webSearchConfig: { maxUses: 999 } }));
    await readEvents(response);

    const [params] = mocks.messagesStream.mock.calls[0]!;
    expect(params.tools[0].max_uses).toBe(3);
  });

  it.each([
    ['通常の送信', {}],
    ['続き生成', { sessionId: 'session-1', isContinuation: true, truncatedContent: '前半' }],
  ])('%s は、生成の前に trial の枠を1回分予約する', async (_label, body) => {
    const response = await POST(streamRequest(body));
    await readEvents(response);

    expect(mocks.reserveTrialChatSend).toHaveBeenCalledTimes(1);
    expect(mocks.reserveTrialChatSend).toHaveBeenCalledWith('trial', USER_ID);
    expect(mocks.reserveTrialChatSend.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.messagesStream.mock.invocationCallOrder[0]!
    );
  });

  it('続き生成は、予約した後の保存で上限に引っかからず、本文を元のメッセージへ上書き保存する', async () => {
    const response = await POST(
      streamRequest({ sessionId: 'session-1', isContinuation: true, truncatedContent: '前半' })
    );
    const events = await readEvents(response);

    expect(mocks.updateLastAssistantMessage).toHaveBeenCalledWith(
      USER_ID,
      'session-1',
      '前半続きの本文',
      expect.anything()
    );
    expect(events).toContain('event: final');
  });

  it('枠を予約できなければ、生成せずに 429 で断る', async () => {
    mocks.reserveTrialChatSend.mockResolvedValue(ERROR_MESSAGES.CHAT.DAILY_CHAT_LIMIT);

    const response = await POST(
      streamRequest({ sessionId: 'session-1', isContinuation: true, truncatedContent: '前半' })
    );

    expect(response.status).toBe(429);
    expect(mocks.messagesStream).not.toHaveBeenCalled();
  });
});
