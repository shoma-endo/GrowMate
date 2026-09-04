import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * **429 の扱いを Anthropic SDK クライアント層から検証する。**
 *
 * `contentAnnotationSummaryService.test.ts` の 429 テストは `llmChat` をモックして
 * `ChatError(ANTHROPIC_RATE_LIMIT)` を直接投げるため、SDK 層は一度も走らない。
 * SDK は既定で 429 を最大2回**バックオフして寝てから**再送する（`maxRetries` 既定 2）ので、
 * その構成ではレート制限中に時間予算だけが減り、末尾チャンク（`llmMs` 最小30秒）では
 * 寝ている間に呼び出し側の abort が先に立って `CONNECTION_TIMEOUT` になり、
 * `SUMMARY_AI_RATE_LIMITED` ではなく `SUMMARY_AI_FAILED` へ落ちる。
 * BR-B11「待機・再試行しない」/ AC-B17 が満たされているかは、モックの層を SDK まで下げないと
 * 構造的に検知できない。ここでは `llmService` を**実物のまま**通す。
 */

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  fetchWpPostContentLive: vi.fn(),
  getTemplateByName: vi.fn(),
  replaceVariables: vi.fn(),
  /** SDK の `messages.create` に届いたリクエストオプションを発射ごとに記録する */
  anthropicRequests: [] as { maxRetries: number | undefined }[],
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

vi.mock('@/env', () => ({
  env: { ANTHROPIC_API_KEY: 'test-anthropic-key', OPENAI_API_KEY: 'test-openai-key' },
}));

vi.mock('openai', () => ({ default: class {} }));

/** Anthropic の 429 レスポンスと同じ形（`status` と `error.type` を持つ）の例外 */
class FakeRateLimitError extends Error {
  status = 429;
  error = { type: 'rate_limit_error' as const };
  constructor() {
    super('429 Too Many Requests');
    this.name = 'RateLimitError';
  }
}

/**
 * SDK の再送契約を模したクライアント。`maxRetries` の指定回数だけ 429 を再送し、
 * 各再送の前にバックオフとして待つ（実際の SDK と同じく `signal` で中断される）。
 * `maxRetries` 未指定は SDK 既定の 2。
 */
const BACKOFF_MS = 1_000;
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (_params: unknown, options?: { signal?: AbortSignal; maxRetries?: number }) => {
        const maxRetries = options?.maxRetries ?? 2;
        for (let attempt = 0; ; attempt += 1) {
          mocks.anthropicRequests.push({ maxRetries: options?.maxRetries });
          if (attempt >= maxRetries) throw new FakeRateLimitError();
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, BACKOFF_MS);
            options?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('Request was aborted.'));
              },
              { once: true }
            );
          });
        }
      },
      stream: vi.fn(),
    };
  },
}));

import { contentAnnotationSummaryService } from '@/server/services/contentAnnotationSummaryService';

const annotation = {
  id: 'annotation-id',
  user_id: 'user-id',
  session_id: null,
  wp_post_id: 42,
  canonical_url: null,
  wp_post_title: '記事タイトル',
  impressions: null,
};

describe('contentAnnotationSummaryService の 429 挙動（SDK 層まで通す）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anthropicRequests.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.fetchWpPostContentLive.mockResolvedValue({
      contentText: '記事本文',
      contentHtml: '<p>記事本文</p>',
      title: '記事タイトル',
      excerpt: null,
    });
    mocks.getTemplateByName.mockResolvedValue({ content: 'template' });
    mocks.replaceVariables.mockReturnValue('filled prompt');
    mocks.maybeSingle.mockResolvedValue({ data: annotation, error: null });
  });

  /**
   * 落とせない網: 429 を受けても**再送せず・待たず**、失敗理由が `SUMMARY_AI_RATE_LIMITED` に
   * 分類されること。`maxRetries: 0` の詰め替えが1行でも欠けると、SDK は2回再送するので
   * リクエスト数が増え、`llmMs` が短い末尾チャンクでは `SUMMARY_AI_FAILED` に化ける。
   */
  it('429 を再送も待機もせず SUMMARY_AI_RATE_LIMITED に分類する', async () => {
    const startedAt = Date.now();
    const result = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
    });

    expect(result).toEqual({ success: false, code: 'SUMMARY_AI_RATE_LIMITED' });
    // 上流への発射は1回だけ（SDK 既定の 2回再送が効いていれば3回になる）
    expect(mocks.anthropicRequests).toEqual([{ maxRetries: 0 }]);
    // バックオフで寝ていない（1回でも寝ていれば BACKOFF_MS 以上かかる）
    expect(Date.now() - startedAt).toBeLessThan(BACKOFF_MS);
  });

  /**
   * 末尾チャンクの再現: `llmMs` が最小 30 秒まで下がった状態でも、再送で寝ないので
   * abort が先に立たず、レート制限が `CONNECTION_TIMEOUT` 由来の `SUMMARY_AI_FAILED` へ
   * 化けないこと。BACKOFF_MS より短いタイムアウトで、再送があれば必ず落ちる条件にしてある。
   */
  it('LLM タイムアウトが短くても 429 が SUMMARY_AI_FAILED へ化けない', async () => {
    const result = await contentAnnotationSummaryService.generateSummary({
      target: { annotationId: 'annotation-id' },
      executorUserId: 'user-id',
      llmTimeoutMs: BACKOFF_MS / 2,
    });

    expect(result).toEqual({ success: false, code: 'SUMMARY_AI_RATE_LIMITED' });
    expect(mocks.anthropicRequests).toHaveLength(1);
  });
});
