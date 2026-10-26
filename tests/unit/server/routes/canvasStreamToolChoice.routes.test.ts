import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  messagesStream: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ env: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class {
    messages = { stream: mocks.messagesStream };
  },
}));
vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: vi.fn(async () => ({ userId: 'user-1', userDetails: { role: 'paid' } })),
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({ sse409IfEmailLinkConflict: () => null }));
vi.mock('@/server/services/chatLimitService', () => ({ reserveTrialChatSend: vi.fn(async () => null) }));
vi.mock('@/lib/prompts', () => ({ getBlogCreationTemplatePrompt: vi.fn(async () => null) }));
vi.mock('@/lib/knowledgeInjection', () => ({
  resolveKnowledgeBlocksForRequest: vi.fn(async (systemPrompt: string) => ({
    anthropicSystem: [{ type: 'text', text: systemPrompt }],
  })),
}));
vi.mock('@/server/services/chatService', () => ({ chatService: { continueChat: vi.fn(async () => ({})) } }));
vi.mock('@/server/services/headingFlowService', () => ({ headingFlowService: {} }));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    createChatMessage = vi.fn(async () => ({ success: true }));
    getChatSessionById = vi.fn(async () => ({ success: false }));
  },
}));

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { POST } from '../../../../app/api/chat/canvas/stream/route';

function fakeStream(content: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } };
      yield { type: 'message_stop' };
    },
    finalMessage: async () => ({
      content,
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  };
}

const EDIT_RESULT = [
  { type: 'tool_use', name: 'apply_full_text_replacement', input: { full_markdown: '編集後の本文' } },
];

function canvasRequest(step: string) {
  return new NextRequest('http://localhost/api/chat/canvas/stream', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'session-1',
      instruction: 'もっと簡潔にして',
      selectedText: '本文',
      canvasContent: '本文',
      contentStep: step,
      targetStep: step,
    }),
  });
}

describe('Canvas 編集の tool_choice', () => {
  beforeEach(() => {
    mocks.messagesStream.mockReset();
  });

  // ツールを呼ばず本文や確認の質問だけを返す失敗（no_tool_use）は Haiku 5.5 の工程に集中していた
  it.each(['step6', 'step7'])('Haiku 5.5 の %s は編集ツールの呼び出しを強制する', async step => {
    mocks.messagesStream.mockImplementation(async () => fakeStream(EDIT_RESULT));

    await (await POST(canvasRequest(step))).text();

    expect(mocks.messagesStream.mock.calls[0]![0]).toMatchObject({
      model: 'claude-haiku-5-5',
      tool_choice: { type: 'tool', name: 'apply_full_text_replacement' },
    });
  });

  it('強制指定を 400 で拒否する Sonnet 5.5 の工程は auto で送る', async () => {
    mocks.messagesStream.mockImplementation(async () => fakeStream(EDIT_RESULT));

    await (await POST(canvasRequest('step1'))).text();

    expect(mocks.messagesStream.mock.calls[0]![0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      tool_choice: { type: 'auto' },
    });
  });

  it('ツールを呼ばずに文章だけ返した応答では本文を置き換えずエラーにする', async () => {
    mocks.messagesStream.mockImplementation(async () =>
      fakeStream([{ type: 'text', text: '確認させてください。' }])
    );

    const body = await (await POST(canvasRequest('step1'))).text();

    expect(body).toContain('"type":"no_tool_use"');
    expect(body).toContain(ERROR_MESSAGES.CHAT.CANVAS_EDIT_NOT_RETURNED);
    expect(body).not.toContain('event: done');
  });
});
