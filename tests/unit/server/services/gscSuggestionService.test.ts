import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTemplateByName: vi.fn(),
  llmChat: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@/server/services/promptService', () => ({
  PromptService: {
    getTemplateByName: mocks.getTemplateByName,
    replaceVariables: vi.fn(() => 'filled prompt'),
  },
}));

vi.mock('@/server/services/llmService', () => ({
  llmChat: mocks.llmChat,
}));

vi.mock('@/server/services/wordpressContext', () => ({
  buildWordPressServiceFromSettings: vi.fn(),
  WPCOM_TOKEN_COOKIE_NAME: 'wpcom_token',
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        from: vi.fn(() => query),
        select: vi.fn(() => query),
        update: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: mocks.maybeSingle,
      };
      return query;
    }
  },
}));

import { gscSuggestionService } from '@/server/services/gscSuggestionService';

describe('gscSuggestionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.getTemplateByName.mockResolvedValue({ content: 'template' });
    mocks.llmChat.mockResolvedValue('generated suggestion');
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'annotation-id',
          wp_post_id: null,
          wp_post_title: 'title',
          opening_proposal: null,
          wp_content_text: 'cached content',
          wp_excerpt: 'cached excerpt',
          persona: null,
          needs: null,
          main_kw: 'main keyword',
          kw: 'keyword',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'history-id' }, error: null });
  });

  it('LLM呼び出しに220秒のtimeoutと呼び出し元のsignalを渡す', async () => {
    const controller = new AbortController();

    await gscSuggestionService.generate({
      userId: 'user-id',
      contentAnnotationId: 'annotation-id',
      evaluationHistoryId: 'history-id',
      outcome: 'no_change',
      currentPosition: 10,
      previousPosition: 10,
      currentSuggestionStage: 1,
      jobToken: 'job-token',
      signal: controller.signal,
    });

    expect(mocks.llmChat).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [{ role: 'user', content: 'filled prompt' }],
      expect.objectContaining({
        timeoutMs: 220000,
        signal: controller.signal,
      })
    );
  });
});

