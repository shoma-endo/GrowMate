import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  fetchWpPostContentLive: vi.fn(),
  getTemplateByName: vi.fn(),
  replaceVariables: vi.fn(),
  llmChat: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: mocks.select,
        update: mocks.update,
        eq: mocks.eq,
        maybeSingle: mocks.maybeSingle,
      };
      mocks.select.mockReturnValue(query);
      mocks.update.mockReturnValue(query);
      mocks.eq.mockReturnValue(query);
      mocks.from.mockReturnValue(query);
      return { from: mocks.from };
    }
  },
}));

vi.mock('@/server/services/wordpressContentSync', () => ({
  fetchWpPostContentLive: mocks.fetchWpPostContentLive,
}));

vi.mock('@/server/services/promptService', () => ({
  PromptService: {
    getTemplateByName: mocks.getTemplateByName,
    replaceVariables: mocks.replaceVariables,
  },
}));

vi.mock('@/server/services/llmService', () => ({
  llmChat: mocks.llmChat,
}));

import { contentAnnotationSummaryService } from '@/server/services/contentAnnotationSummaryService';

describe('contentAnnotationSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchWpPostContentLive.mockResolvedValue({
      contentText: '元記事の書き出し 記事本文',
      contentHtml: '<p>元記事の<strong>書き出し</strong></p><h2>見出し</h2><p>記事本文</p>',
      title: '記事タイトル',
      excerpt: null,
    });
    mocks.getTemplateByName.mockResolvedValue({ content: 'template' });
    mocks.replaceVariables.mockReturnValue('filled prompt');
    mocks.llmChat.mockResolvedValue(`\`\`\`json
{"main_kw":"主軸kw","kw":"関連kw","needs":"ニーズ","persona":"ペルソナ","goal":"ゴール","prep":"PREP","opening_proposal":"書き出し"}
\`\`\``);
  });

  it('session_idがない本人所有のインポート記事をannotationIdで要約・保存する', async () => {
    const importedAnnotation = {
      id: 'annotation-id',
      user_id: 'user-id',
      session_id: null,
      wp_post_id: 42,
      canonical_url: 'https://example.com/sample-post/',
      wp_post_title: '記事タイトル',
      impressions: '100',
    };
    mocks.maybeSingle
      .mockResolvedValueOnce({ data: importedAnnotation, error: null })
      .mockResolvedValueOnce({
        data: { ...importedAnnotation, main_kw: '主軸kw', basic_structure: 'h2 見出し' },
        error: null,
      });

    const generated = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
      cookieStore: { get: vi.fn() } as never,
    });

    expect(generated.success).toBe(true);
    if (!generated.success) return;
    expect(generated.annotationId).toBe('annotation-id');
    expect(generated.userId).toBe('user-id');
    expect(generated.fields.opening_proposal).toBe('元記事の書き出し');
    expect(generated.fields.opening_proposal).not.toBe('書き出し');
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-id');
    expect(mocks.fetchWpPostContentLive).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-id', wpPostId: 42 })
    );

    const saved = await contentAnnotationSummaryService.saveSummary({
      annotationId: generated.annotationId,
      userId: generated.userId,
      fields: generated.fields,
    });

    expect(saved.success).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ impressions: expect.anything() })
    );
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'user-id');
  });
});
