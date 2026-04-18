import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ChatError } from '@/domain/errors/ChatError';
import { env } from '@/env';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMOptions {
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  // Note: seed/top_p are configured in MODEL_CONFIGS but not currently used
  // Future implementation: use provider(model).withSettings({ seed, topP }) if needed
  /**
   * LLM呼び出しのタイムアウト（ミリ秒）。未指定時は 300000ms。
   */
  timeoutMs?: number;
}

export class LLMService {
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

    try {
      const llmPromise =
        providerKey === 'openai'
          ? this.callOpenAI(model, systemPrompt, chatMessages, opts)
          : this.callAnthropic(model, systemPrompt, chatMessages, opts);

      // タイムアウト（デフォルト300秒）
      const text = await Promise.race([
        llmPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), opts.timeoutMs ?? 300000)
        ),
      ]);

      return text;
    } catch (error) {
      const latency = Date.now() - startTime;
      console.error(
        `LLM Chat Error - Provider: ${providerKey}, Model: ${model}, Latency: ${latency}ms, Error:`,
        error
      );

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
    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
      temperature: opts.temperature ?? 0.7,
      max_completion_tokens: opts.maxTokens ?? 3000,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('OpenAI: 応答が空でした');
    return text;
  }

  private async callAnthropic(
    model: string,
    systemPrompt: string | undefined,
    messages: LLMMessage[],
    opts: LLMOptions
  ): Promise<string> {
    const params = {
      model,
      ...(systemPrompt
        ? {
            system: [
              {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
          }
        : {}),
      messages: messages.map(m => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: [{ type: 'text' as const, text: m.content }],
      })),
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      max_tokens: opts.maxTokens ?? 3000,
    };

    const resp = await this.anthropic.messages.create(params);

    const text =
      resp.content
        ?.map(block => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim() ?? '';
    if (!text) throw new Error('Anthropic: 応答が空でした');
    return text;
  }
}

export const llmService = new LLMService();
export const llmChat = llmService.llmChat.bind(llmService);
