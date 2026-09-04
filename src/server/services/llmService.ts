import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { env } from '@/env';
import type { AnthropicSystemBlock } from '@/lib/knowledgeInjection';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMOptions {
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  stream?: boolean | undefined;
  /**
   * LLM呼び出しのタイムアウト（ミリ秒）。未指定時は 300000ms。
   */
  timeoutMs?: number;
  signal?: AbortSignal;
  anthropicSystemBlocks?: AnthropicSystemBlock[];
  /**
   * Anthropic の拡張思考（Anthropic 経路のみ）。**未指定なら `params` に載せない**ので、
   * 既存の呼び出し側の挙動は変わらない（`temperature` と同じ扱い）。
   *
   * 明示的な無効化が要るのは、モデルによっては省略時にアダプティブ思考が既定で有効になり、
   * 思考トークンが出力料金で課金されるため。思考テキストはレスポンスに返らないので、
   * 指定漏れは請求額でしか気づけない。
   */
  thinking?: { type: 'disabled' | 'adaptive' } | undefined;
  /**
   * Anthropic SDK のリクエスト単位の再送回数（Anthropic 経路のみ）。**未指定なら渡さない**ので、
   * 既存の呼び出し側は SDK 既定（2回）のまま（`thinking` / `temperature` と同じ扱い）。
   *
   * SDK は 429 / 5xx / 接続エラーを既定で最大2回**バックオフして寝てから**再送する。
   * 「待機・再試行しない」ことが要件の経路（一括要約ジョブ）では `0` を渡す。寝ている間に
   * 呼び出し側の AbortController が先に発火すると `CONNECTION_TIMEOUT` になり、
   * レート制限が別の失敗理由に化けるため。共有クライアントの既定は変えない。
   */
  maxRetries?: number | undefined;
}

class LLMService {
  private openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  private anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  async llmChat(
    providerKey: 'openai' | 'anthropic',
    model: string,
    messages: LLMMessage[],
    opts: LLMOptions = {}
  ): Promise<string> {
    const startTime = Date.now();

    // 先頭に system があれば分離
    let systemPrompt: string | undefined;
    let chatMessages = messages;
    if (messages[0]?.role === 'system') {
      systemPrompt = messages[0].content;
      chatMessages = messages.slice(1) as Exclude<LLMMessage, { role: 'system' }>[];
    }

    let timeoutTriggered = false;
    try {
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(opts.signal?.reason);
      if (opts.signal?.aborted) {
        abortFromCaller();
      } else {
        opts.signal?.addEventListener('abort', abortFromCaller, { once: true });
      }
      const timeoutId = setTimeout(
        () => {
          timeoutTriggered = true;
          controller.abort(new Error('timeout'));
        },
        opts.timeoutMs ?? 300000
      );

      const requestOptions = { ...opts, signal: controller.signal };
      const llmPromise =
        providerKey === 'openai'
          ? this.callOpenAI(model, systemPrompt, chatMessages, requestOptions)
          : this.callAnthropic(
              model,
              systemPrompt,
              chatMessages,
              requestOptions,
              opts.anthropicSystemBlocks
            );

      const text = await llmPromise.finally(() => {
        clearTimeout(timeoutId);
        opts.signal?.removeEventListener('abort', abortFromCaller);
      });

      return text;
    } catch (error) {
      const latency = Date.now() - startTime;
      console.error(
        `LLM Chat Error - Provider: ${providerKey}, Model: ${model}, Latency: ${latency}ms, Error:`,
        error
      );

      if (timeoutTriggered) {
        throw new ChatError(
          `LLM request timed out after ${opts.timeoutMs ?? 300000}ms`,
          ChatErrorCode.CONNECTION_TIMEOUT,
          { provider: providerKey, model, timeoutMs: opts.timeoutMs ?? 300000 }
        );
      }

      // すべてのプロバイダでフォールバックは行わず、発生したエラーをそのままユーザー向けにマッピング
      throw ChatError.fromApiError(error, { provider: providerKey, model });
    }
  }

  private async callOpenAI(
    model: string,
    systemPrompt: string | undefined,
    messages: LLMMessage[],
    opts: LLMOptions
  ): Promise<string> {
    const completion = await this.openai.chat.completions.create(
      {
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        temperature: opts.temperature ?? 0.7,
        max_completion_tokens: opts.maxTokens ?? 3000,
      },
      { signal: opts.signal }
    );

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('OpenAI: 応答が空でした');
    return text;
  }

  private async callAnthropic(
    model: string,
    systemPrompt: string | undefined,
    messages: LLMMessage[],
    opts: LLMOptions,
    anthropicSystemBlocks?: AnthropicSystemBlock[]
  ): Promise<string> {
    const systemBlocks =
      anthropicSystemBlocks && anthropicSystemBlocks.length > 0
        ? anthropicSystemBlocks
        : systemPrompt
          ? [
              {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' as const },
              },
            ]
          : undefined;

    const params = {
      model,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      messages: messages.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: [{ type: 'text' as const, text: m.content }],
      })),
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      // 未指定なら載せない（temperature と同型）。載せない＝既存機能は現行どおり
      ...(opts.thinking !== undefined && { thinking: opts.thinking }),
      max_tokens: opts.maxTokens ?? 3000,
    };

    // リクエスト単位のオプション。`maxRetries` は未指定なら載せない＝SDK 既定（2回）のまま。
    // 共有クライアント（`this.anthropic`）の既定を書き換えると他機能の再送挙動まで変わる
    const sdkRequestOptions = {
      signal: opts.signal,
      ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    };

    const resp = opts.stream
      ? await this.anthropic.messages.stream(params, sdkRequestOptions).finalMessage()
      : await this.anthropic.messages.create(params, sdkRequestOptions);

    // 出力が max_tokens で打ち切られた場合は本番ログで検知できるようにする
    // （末尾の JSON ブロック欠落など、サイレントな出力欠けの原因になるため）。
    if (resp.stop_reason === 'max_tokens') {
      console.warn('[LLMService] output truncated at max_tokens', {
        model,
        maxTokens: params.max_tokens,
        outputTokens: resp.usage?.output_tokens,
        inputTokens: resp.usage?.input_tokens,
      });
    }

    const text =
      resp.content
        ?.map(block => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim() ?? '';
    if (!text) throw new Error('Anthropic: 応答が空でした');
    return text;
  }
}

const llmService = new LLMService();
export const llmChat = llmService.llmChat.bind(llmService);
