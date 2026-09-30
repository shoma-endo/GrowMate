import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failNext, resetStore, rows } from './instagramBlogDraftFakeSupabase';

vi.mock('server-only', () => ({}));

vi.mock('@/server/services/supabaseService', async () => {
  const { FakeSupabaseService } = await import('./instagramBlogDraftFakeSupabase');
  return { SupabaseService: FakeSupabaseService };
});

type Message = { role: 'user' | 'assistant'; content: string; model?: string };
const messages: Message[] = [];

vi.mock('@/server/services/chatService', () => ({
  chatService: {
    getSessionMessages: vi.fn(async () => messages.map(message => ({ ...message }))),
    continueChat: vi.fn(async (_userId: string, _sessionId: string, [input, output]: [string, string], _s: string, _h: unknown[], model: string) => {
      messages.push({ role: 'user', content: input }, { role: 'assistant', content: output, model });
      return {};
    }),
    updateLastAssistantMessage: vi.fn(async (_userId: string, sessionId: string, content: string) => {
      const last = messages.filter(message => message.role === 'assistant').at(-1);
      if (last) last.content = content;
      return { sessionId };
    }),
  },
}));

vi.mock('@/server/services/headingFlowService', () => ({
  headingFlowService: {
    initializeHeadingSections: vi.fn(),
    getHeadingSections: vi.fn(),
    getStep7UserLeadResult: vi.fn(),
    saveStep7UserLead: vi.fn(),
    saveHeadingSection: vi.fn(),
    saveCombinedContentForStep7: vi.fn(),
  },
}));

vi.mock('@/server/services/llmService', () => ({ llmChatWithStopReason: vi.fn() }));

vi.mock('@/lib/prompts', () => ({
  getSystemPrompt: vi.fn(async (model: string) => `system:${model}`),
  generateInstagramBlogKeywordPrompt: vi.fn(async () => 'system:keywords'),
}));

vi.mock('@/lib/knowledgeInjection', () => ({
  resolveKnowledgeBlocksForRequest: vi.fn(async (systemPrompt: string) => ({ anthropicSystem: [{ type: 'text', text: systemPrompt }] })),
}));

import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { CONTINUATION_INSTRUCTION } from '@/lib/chat-continuation';
import { getSystemPrompt } from '@/lib/prompts';
import { chatService } from '@/server/services/chatService';
import { headingFlowService } from '@/server/services/headingFlowService';
import { llmChatWithStopReason } from '@/server/services/llmService';
import { instagramBlogDraftRunner, InstagramBlogDraftFailure } from '@/server/services/instagramBlogDraftRunner';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const T0 = Date.parse('2026-09-30T00:00:00Z');
const DEADLINE = T0 + 740_000;
const CAPTION = '割れた卵を無料で交換しました';
const STEP6_OUTPUT = [
  '【書き出し案：パターンA（課題解決型・王道）】',
  '▼本文（通常版）',
  '通常版の書き出しです。',
  '▼本文（短縮版）',
  '短縮版です。',
  '【書き出し案：パターンB】',
].join('\n');
const SECTIONS = [
  { heading_key: 'h0', heading_text: '見出しA' },
  { heading_key: 'h1', heading_text: '見出しB' },
];

function seedJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const job = {
    id: 'job-1',
    user_id: USER_ID,
    instagram_media_id: 'media-1',
    session_id: null,
    batch_id: 'batch-1',
    status: 'running',
    stage: 'keywords',
    heading_index: 0,
    heading_total: null,
    error_code: null,
    continuation_count: null,
    ...overrides,
  };
  rows('instagram_blog_draft_jobs').push(job);
  return job;
}

function seedSession(annotation: Record<string, unknown> = {}): void {
  rows('chat_sessions').push({ id: SESSION_ID, user_id: USER_ID });
  rows('content_annotations').push({ user_id: USER_ID, session_id: SESSION_ID, main_kw: '卵', kw: '交換\n補償', ...annotation });
}

function llmReturns(...outputs: Array<string | { content: string; stopReason: string }>): void {
  for (const output of outputs) {
    vi.mocked(llmChatWithStopReason).mockResolvedValueOnce(
      typeof output === 'string' ? { content: output, stopReason: 'end_turn' } : output
    );
  }
}

function llmUserMessages(): string[] {
  return vi.mocked(llmChatWithStopReason).mock.calls.map(call => call[2].at(-1)?.content ?? '');
}

const run = () => instagramBlogDraftRunner.run('job-1', USER_ID, 'paid', DEADLINE);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(llmChatWithStopReason).mockReset();
  resetStore();
  messages.splice(0);
  rows('instagram_media').push({ id: 'media-1', user_id: USER_ID, caption: CAPTION });
  vi.spyOn(Date, 'now').mockReturnValue(T0);
  vi.stubGlobal('crypto', { randomUUID: () => SESSION_ID });
  vi.mocked(headingFlowService.initializeHeadingSections).mockResolvedValue({ success: true, data: undefined });
  vi.mocked(headingFlowService.getHeadingSections).mockResolvedValue({ success: true, data: SECTIONS } as never);
  vi.mocked(headingFlowService.getStep7UserLeadResult).mockResolvedValue({ success: true, data: null });
  vi.mocked(headingFlowService.saveStep7UserLead).mockResolvedValue({ success: true, data: undefined } as never);
  vi.mocked(headingFlowService.saveHeadingSection).mockResolvedValue({ success: true, data: undefined } as never);
  vi.mocked(headingFlowService.saveCombinedContentForStep7).mockResolvedValue({ success: true, data: undefined } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Instagram ブログ自動作成の実行（Runner）', () => {
  it('キーワード案から完成形まで、手動フローと同じ入力・保存先・モデルで進める', async () => {
    const job = seedJob();
    llmReturns(
      '```json\n{"main_kw":"卵 交換","kw":["補償","割れ"]}\n```',
      'step1 出力', 'step2 出力', 'step3 出力', 'step4 出力', 'step5 出力', STEP6_OUTPUT,
      '見出しAの本文', '見出しBの本文'
    );

    await expect(run()).resolves.toBe('completed');

    expect(rows('chat_sessions')).toEqual([expect.objectContaining({ id: SESSION_ID, user_id: USER_ID, title: '卵 交換', service_id: null })]);
    expect(rows('content_annotations')[0]).toMatchObject({
      session_id: SESSION_ID,
      main_kw: '卵 交換',
      kw: '補償\n割れ',
      needs: 'step1 出力',
      persona: 'step2 出力',
      goal: 'step3 出力',
      prep: 'step4 出力',
      basic_structure: 'step5 出力',
      opening_proposal: STEP6_OUTPUT,
    });
    const inputs = llmUserMessages();
    expect(inputs[1]).toBe(`卵 交換\n補償\n割れ\n\n【元になった Instagram 投稿】\n${CAPTION}`);
    expect(inputs[2]).toBe('step1 出力');
    expect(inputs[6]).toBe(`step5 出力\n\n【一次情報（元の Instagram 投稿）】\n${CAPTION}`);
    expect(inputs[7]).toContain('「見出しA」の本文を書いてください');
    expect(inputs[8]).toBe('「見出しB」の本文を書いてください');
    expect(messages.filter(message => message.role === 'assistant').map(message => message.model)).toEqual([
      'blog_creation_step1', 'blog_creation_step2', 'blog_creation_step3', 'blog_creation_step4',
      'blog_creation_step5', 'blog_creation_step6', 'blog_creation_step7_h0', 'blog_creation_step7_h1',
    ]);
    expect(headingFlowService.initializeHeadingSections).toHaveBeenCalledWith(SESSION_ID, 'step5 出力');
    expect(headingFlowService.saveStep7UserLead).toHaveBeenCalledWith(SESSION_ID, USER_ID, '通常版の書き出しです。');
    expect(vi.mocked(headingFlowService.saveHeadingSection).mock.calls.map(call => [call[1], call[2]])).toEqual([
      ['h0', '見出しAの本文'],
      ['h1', '見出しBの本文'],
    ]);
    expect(headingFlowService.saveCombinedContentForStep7).toHaveBeenCalledWith(SESSION_ID, USER_ID);
    expect(job).toMatchObject({ status: 'completed', stage: 'done', heading_total: 2, heading_index: 2 });
  });

  it('プロンプトは Cookie ではなく userId を明示して組み立て、見出しは見出し単位のモデルで呼ぶ', async () => {
    seedSession();
    seedJob({ session_id: SESSION_ID, stage: 'heading', heading_total: 2 });
    messages.push({ role: 'assistant', content: STEP6_OUTPUT, model: 'blog_creation_step6' });
    llmReturns('見出しAの本文', '見出しBの本文');

    await run();

    expect(vi.mocked(getSystemPrompt).mock.calls).toEqual([
      ['blog_creation_step7_h0', undefined, SESSION_ID, undefined, { userId: USER_ID }],
      ['blog_creation_step7_h1', undefined, SESSION_ID, undefined, { userId: USER_ID }],
    ]);
    expect(vi.mocked(llmChatWithStopReason).mock.calls[0]?.[3]).toMatchObject({
      maxTokens: 7000,
      timeoutMs: 180_000,
      maxRetries: 0,
    });
  });

  it('キーワード案の JSON が形式違いなら KEYWORD_PARSE_FAILED', async () => {
    seedJob();
    llmReturns('{"main_kw":"","kw":[]}');

    await expect(run()).rejects.toMatchObject({ code: 'KEYWORD_PARSE_FAILED' });
    expect(rows('chat_sessions')).toHaveLength(0);
  });

  it('429 は AI_RATE_LIMITED、それ以外の AI 失敗は AI_FAILED', async () => {
    seedSession();
    seedJob({ session_id: SESSION_ID, stage: 'step1' });
    vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new ChatError('rate', ChatErrorCode.ANTHROPIC_RATE_LIMIT));
    await expect(run()).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });

    vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('timeout'));
    await expect(run()).rejects.toMatchObject({ code: 'AI_FAILED' });
  });

  describe('途中で切れたとき', () => {
    it('続きだけを生成し、途切れた出力を加工せずに連結して上書きし、連結後の全文を保存する', async () => {
      seedSession({ needs: 'step1 出力' });
      const job = seedJob({ session_id: SESSION_ID, stage: 'step2' });
      messages.push({ role: 'user', content: 'in' }, { role: 'assistant', content: 'step1 出力', model: 'blog_creation_step1' });
      llmReturns({ content: '前半\n', stopReason: 'max_tokens' }, 'H3: 後半');
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop after step2'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(llmUserMessages()[1]).toBe(CONTINUATION_INSTRUCTION);
      expect(chatService.updateLastAssistantMessage).toHaveBeenCalledWith(USER_ID, SESSION_ID, '前半\nH3: 後半', 'blog_creation_step2');
      expect(rows('content_annotations')[0]?.persona).toBe('前半\nH3: 後半');
      expect(vi.mocked(llmChatWithStopReason).mock.calls.filter(call => call[2].at(-1)?.content === 'step1 出力')).toHaveLength(1);
      expect(job).toMatchObject({ stage: 'step3', continuation_count: null });
    });

    it('続きを2回生成してもまだ切れていたら MAX_TOKENS で止め、途切れた出力はメモ・補足情報に保存しない', async () => {
      seedSession({ needs: 'step1 出力' });
      const job = seedJob({ session_id: SESSION_ID, stage: 'step2' });
      messages.push({ role: 'assistant', content: 'step1 出力', model: 'blog_creation_step1' });
      llmReturns(
        { content: 'a', stopReason: 'max_tokens' },
        { content: 'b', stopReason: 'max_tokens' },
        { content: 'c', stopReason: 'max_tokens' }
      );

      await expect(run()).rejects.toMatchObject({ code: 'MAX_TOKENS' });

      expect(llmChatWithStopReason).toHaveBeenCalledTimes(3);
      expect(messages.at(-1)).toMatchObject({ content: 'abc', model: 'blog_creation_step2' });
      expect(job).toMatchObject({ stage: 'step2', continuation_count: 2 });
      expect(rows('content_annotations')[0]?.persona).toBeUndefined();
    });
  });

  describe('再開位置の判定', () => {
    it('保存後・段階の更新前に落ちた行は、AI を呼ばずに保存済みの出力で後続の保存だけ行う', async () => {
      seedSession();
      const job = seedJob({ session_id: SESSION_ID, stage: 'step1' });
      messages.push({ role: 'user', content: 'in' }, { role: 'assistant', content: '保存済みの step1', model: 'blog_creation_step1' });
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at step2'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(rows('content_annotations')[0]?.needs).toBe('保存済みの step1');
      expect(llmUserMessages()).toEqual(['保存済みの step1']);
      expect(job.stage).toBe('step2');
    });

    it('続きの生成中に止まった行を再開すると、同じステップを作り直さず続きから入る', async () => {
      seedSession({ needs: 'step1 出力' });
      seedJob({ session_id: SESSION_ID, stage: 'step2', continuation_count: 0 });
      messages.push(
        { role: 'assistant', content: 'step1 出力', model: 'blog_creation_step1' },
        { role: 'user', content: 'step1 出力' },
        { role: 'assistant', content: '途切れた前半', model: 'blog_creation_step2' }
      );
      llmReturns('の続き');
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at step3'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(llmUserMessages()[0]).toBe(CONTINUATION_INSTRUCTION);
      expect(chatService.continueChat).not.toHaveBeenCalledWith(USER_ID, SESSION_ID, expect.anything(), '', [], 'blog_creation_step2');
      expect(rows('content_annotations')[0]?.persona).toBe('途切れた前半の続き');
    });

    it('途切れを記録した後、途切れた出力の保存前に落ちた行は、記録を消してそのステップを生成し直す', async () => {
      seedSession({ needs: 'step1 出力' });
      const job = seedJob({ session_id: SESSION_ID, stage: 'step2', continuation_count: 0 });
      messages.push({ role: 'assistant', content: 'step1 出力', model: 'blog_creation_step1' });
      llmReturns('step2 出力');
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at step3'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(llmUserMessages()[0]).toBe('step1 出力');
      expect(job).toMatchObject({ stage: 'step3', continuation_count: null });
    });

    it('keywords から再開したとき、チャットと行があればキーワード案を作らずに進める', async () => {
      seedSession();
      const job = seedJob({ session_id: SESSION_ID, stage: 'keywords' });
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at step1'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(rows('chat_sessions')).toHaveLength(1);
      expect(rows('content_annotations')).toHaveLength(1);
      expect(llmUserMessages()[0]).toContain('【元になった Instagram 投稿】');
      expect(job.stage).toBe('step1');
    });

    it('keywords から再開したとき、チャットだけあって行が無ければ、キーワード案を作り直して同じチャットに行を作る', async () => {
      rows('chat_sessions').push({ id: SESSION_ID, user_id: USER_ID });
      seedJob({ session_id: SESSION_ID, stage: 'keywords' });
      llmReturns('{"main_kw":"卵","kw":["交換"]}');
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at step1'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(rows('chat_sessions')).toHaveLength(1);
      expect(rows('content_annotations')).toEqual([expect.objectContaining({ session_id: SESSION_ID, main_kw: '卵' })]);
    });
  });

  describe('見出しの準備（headings）', () => {
    function seedHeadingsStage(): Record<string, unknown> {
      seedSession();
      messages.push(
        { role: 'assistant', content: 'step5 出力', model: 'blog_creation_step5' },
        { role: 'assistant', content: STEP6_OUTPUT, model: 'blog_creation_step6' }
      );
      return seedJob({ session_id: SESSION_ID, stage: 'headings' });
    }

    it('書き出しが保存済みなら書き出しを保存し直さない', async () => {
      seedHeadingsStage();
      vi.mocked(headingFlowService.getStep7UserLeadResult).mockResolvedValue({ success: true, data: '保存済み' });
      vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at heading'));

      await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

      expect(headingFlowService.saveStep7UserLead).not.toHaveBeenCalled();
    });

    it('書き出しの保存済み確認の読み取りに失敗したら、書き出しを保存せず SAVE_FAILED', async () => {
      seedHeadingsStage();
      vi.mocked(headingFlowService.getStep7UserLeadResult).mockResolvedValue({ success: false, error: 'db' } as never);

      await expect(run()).rejects.toMatchObject({ code: 'SAVE_FAILED' });
      expect(headingFlowService.saveStep7UserLead).not.toHaveBeenCalled();
    });

    it('見出しが0件なら NO_HEADINGS', async () => {
      seedHeadingsStage();
      vi.mocked(headingFlowService.getHeadingSections).mockResolvedValue({ success: true, data: [] } as never);

      await expect(run()).rejects.toMatchObject({ code: 'NO_HEADINGS' });
    });

    it('step6 の出力から書き出しを取り出せなければ LEAD_PARSE_FAILED', async () => {
      seedSession();
      messages.push(
        { role: 'assistant', content: 'step5 出力', model: 'blog_creation_step5' },
        { role: 'assistant', content: '形式の違う書き出し案', model: 'blog_creation_step6' }
      );
      seedJob({ session_id: SESSION_ID, stage: 'headings' });

      await expect(run()).rejects.toMatchObject({ code: 'LEAD_PARSE_FAILED' });
      expect(headingFlowService.saveStep7UserLead).not.toHaveBeenCalled();
    });
  });

  it('見出しの本文は、手動の［保存］と同じく後続の見出しすべてで切り落としてから保存する', async () => {
    seedSession();
    seedJob({ session_id: SESSION_ID, stage: 'heading', heading_total: 3 });
    vi.mocked(headingFlowService.getHeadingSections).mockResolvedValue({
      success: true,
      data: [...SECTIONS, { heading_key: 'h2', heading_text: '見出しC' }],
    } as never);
    llmReturns('見出しAの本文\n\n### 見出しC\n先取りした本文');
    vi.mocked(llmChatWithStopReason).mockRejectedValueOnce(new Error('stop at h1'));

    await expect(run()).rejects.toBeInstanceOf(InstagramBlogDraftFailure);

    expect(headingFlowService.saveHeadingSection).toHaveBeenCalledWith(SESSION_ID, 'h0', '見出しAの本文');
  });

  describe('保存の失敗', () => {
    it('チャットの保存が error を返したら SAVE_FAILED', async () => {
      seedSession();
      seedJob({ session_id: SESSION_ID, stage: 'step1' });
      llmReturns('step1 出力');
      vi.mocked(chatService.continueChat).mockResolvedValueOnce({ error: 'db' } as never);

      await expect(run()).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    });

    it('見出しの保存が失敗したら SAVE_FAILED', async () => {
      seedSession();
      seedJob({ session_id: SESSION_ID, stage: 'heading', heading_total: 2 });
      llmReturns('見出しAの本文');
      vi.mocked(headingFlowService.saveHeadingSection).mockResolvedValueOnce({ success: false, error: 'db' } as never);

      await expect(run()).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    });

    it('メモ・補足情報の読み取りに失敗したら SAVE_FAILED', async () => {
      seedSession();
      seedJob({ session_id: SESSION_ID, stage: 'step1' });
      failNext('content_annotations', 'select');

      await expect(run()).rejects.toMatchObject({ code: 'SAVE_FAILED' });
      expect(llmChatWithStopReason).not.toHaveBeenCalled();
    });
  });

  describe('時間の上限と行の消失', () => {
    it('残り時間が 200 秒以下なら着手せず待機中に戻す', async () => {
      seedSession();
      const job = seedJob({ session_id: SESSION_ID, stage: 'step3' });

      await expect(instagramBlogDraftRunner.run('job-1', USER_ID, 'paid', T0 + 199_999)).resolves.toBe('queued');

      expect(job).toMatchObject({ status: 'queued', stage: 'step3' });
      expect(llmChatWithStopReason).not.toHaveBeenCalled();
    });

    it('連携解除で行が消えていたら何もせず lost', async () => {
      await expect(run()).resolves.toBe('lost');
      expect(llmChatWithStopReason).not.toHaveBeenCalled();
    });

    it('実行中に行が消えたら（更新0件）次の AI 呼び出しに進まず lost', async () => {
      seedSession();
      seedJob({ session_id: SESSION_ID, stage: 'step1' });
      vi.mocked(llmChatWithStopReason).mockImplementationOnce(async () => {
        rows('instagram_blog_draft_jobs').splice(0);
        return { content: 'step1 出力', stopReason: 'end_turn' };
      });

      await expect(run()).resolves.toBe('lost');
      expect(llmChatWithStopReason).toHaveBeenCalledOnce();
    });
  });
});
