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

import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { MODEL_CONFIGS } from '@/lib/constants';
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
  /**
   * **拡張思考の指定が `llmChat` まで届いていることを固定する。**
   * `MODEL_CONFIGS` に `thinking` を足しても、呼び出し側の詰め替え（この1行）が漏れると
   * `params` には載らず、アダプティブ思考が有効のまま動く。出力は成立するので
   * 失敗としては現れず、**請求額でしか気づけない**（思考テキストもレスポンスに返らない）。
   */
  it('モデル設定の thinking を llmChat のオプションへ詰め替える', async () => {
    const annotation = {
      id: 'annotation-id',
      user_id: 'user-id',
      session_id: null,
      wp_post_id: 42,
      canonical_url: null,
      wp_post_title: '記事タイトル',
      impressions: null,
    };
    mocks.maybeSingle.mockResolvedValueOnce({ data: annotation, error: null });

    await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
      cookieStore: { get: vi.fn() } as never,
    });

    const [, model, , options] = mocks.llmChat.mock.calls[0] as [
      string,
      string,
      unknown,
      { thinking?: { type: string }; maxTokens?: number },
    ];
    expect(model).toBe(MODEL_CONFIGS.content_annotation_ai_summary?.actualModel);
    expect(options.thinking).toEqual({ type: 'disabled' });
    // プロンプト・出力スキーマ・maxTokens は移行で変えない
    expect(options.maxTokens).toBe(8000);
  });

  it('cookieStore 無しでも動く（cron 経路は Cookie を持たない）', async () => {
    const annotation = {
      id: 'annotation-id',
      user_id: 'user-id',
      session_id: null,
      wp_post_id: 42,
      canonical_url: null,
      wp_post_title: '記事タイトル',
      impressions: null,
    };
    mocks.maybeSingle.mockResolvedValueOnce({ data: annotation, error: null });

    const generated = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
    });

    expect(generated.success).toBe(true);
    const call = mocks.fetchWpPostContentLive.mock.calls[0]?.[0] as {
      getCookie: (name: string) => string | undefined;
    };
    expect(call.getCookie('wpcom_oauth_token')).toBeUndefined();
  });

  it('429（ANTHROPIC_RATE_LIMIT）だけ SUMMARY_AI_RATE_LIMITED を返す', async () => {
    const annotation = {
      id: 'annotation-id',
      user_id: 'user-id',
      session_id: null,
      wp_post_id: 42,
      canonical_url: null,
      wp_post_title: '記事タイトル',
      impressions: null,
    };
    mocks.maybeSingle.mockResolvedValue({ data: annotation, error: null });
    mocks.llmChat.mockRejectedValueOnce(
      new ChatError('rate limited', ChatErrorCode.ANTHROPIC_RATE_LIMIT)
    );

    const rateLimited = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
    });
    expect(rateLimited).toEqual({ success: false, code: 'SUMMARY_AI_RATE_LIMITED' });

    mocks.llmChat.mockRejectedValueOnce(new Error('boom'));
    const otherFailure = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
    });
    expect(otherFailure).toEqual({ success: false, code: 'SUMMARY_AI_FAILED' });
  });
});
