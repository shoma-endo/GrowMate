import { NextRequest } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { env } from '@/env';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ChatError } from '@/domain/errors/ChatError';
import { getSystemPrompt } from '@/lib/prompts';
import { checkTrialDailyLimit } from '@/server/services/chatLimitService';
import type { UserRole } from '@/types/user';
import { VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';

export const runtime = 'nodejs';
export const maxDuration = 800;

interface StreamRequest {
  sessionId?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  model: string;
  systemPrompt?: string;
  serviceId?: string;
  enableWebSearch?: boolean;
  webSearchConfig?: {
    maxUses?: number;
    allowedDomains?: string[];
    blockedDomains?: string[];
  };
}

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let eventId = 0;

  const sendSSE = (event: string, data: unknown) => {
    return encoder.encode(`id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendPing = () => {
    return encoder.encode(`id: ${++eventId}\nevent: ping\ndata: {}\n\n`);
  };

  try {
    const {
      sessionId,
      messages,
      userMessage,
      model,
      systemPrompt: systemPromptOverride,
      serviceId,
      enableWebSearch = false,
      webSearchConfig = {},
    }: StreamRequest = await req.json();

    // 認証チェック
    const authHeader = req.headers.get('authorization');
    const liffAccessToken = authHeader?.replace('Bearer ', '');

    const authResult = await authMiddleware(liffAccessToken);
    if (authResult.error) {
      return new Response(sendSSE('error', { type: 'auth', message: authResult.error }), {
        status: 401,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      });
    }
    if (authResult.viewMode) {
      return new Response(
        sendSSE('error', { type: 'view_mode', message: VIEW_MODE_ERROR_MESSAGE }),
        {
          status: 403,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
          },
        }
      );
    }

    const { userId, userDetails } = authResult;
    const userRole = (userDetails?.role ?? 'trial') as UserRole;

    const limitError = await checkTrialDailyLimit(userRole, userId);
    if (limitError) {
      return new Response(sendSSE('error', { type: 'daily_limit', message: limitError }), {
        status: 429,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      });
    }

    // 共有サービスのプロンプト取得を利用

    // 履歴の正規化: 最後のメッセージがuserの場合、今回の入力と結合する
    // Anthropic APIはuser/assistantの交互配置を要求するため、連続するuserメッセージを防ぐ
    const normalizedMessages = [...messages];
    let combinedUserMessage = userMessage;

    const lastMessage = normalizedMessages[normalizedMessages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      const lastMsg = normalizedMessages.pop();
      if (lastMsg) {
        combinedUserMessage = `${lastMsg.content}\n\n${userMessage}`;
      }
    }

    // Anthropic用のメッセージ形式に変換（Prompt Caching対応）
    const anthropicMessages = [
      ...normalizedMessages.map((msg, index) => {
        // 履歴の最後のメッセージにキャッシュを適用（現在のユーザー入力の直前）
        // これにより、ここまでの会話履歴がキャッシュされる
        if (index === normalizedMessages.length - 1) {
          return {
            role: msg.role as 'user' | 'assistant',
            content: [
              {
                type: 'text' as const,
                text: msg.content,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
          };
        }
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        };
      }),
      { role: 'user' as const, content: combinedUserMessage },
    ];

    // ReadableStreamを作成
    const stream = new ReadableStream({
      async start(controller) {
        let fullMessage = '';
        let abortController: AbortController | null = new AbortController();
        let idleTimeout: ReturnType<typeof setTimeout> | null = null;
        let pingInterval: ReturnType<typeof setInterval> | null = null;

        // 初回バイト送出（SSEタイムアウト回避）
        controller.enqueue(encoder.encode(`: open\n\n`));

        const resetIdleTimeout = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          idleTimeout = setTimeout(() => {
            console.warn('[Anthropic Stream] Idle timeout reached');
            abortController?.abort();
          }, 300000); // 300秒（5分）のアイドルタイムアウト
        };

        const cleanup = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          if (pingInterval) clearInterval(pingInterval);
          abortController = null;
        };

        try {
          // ping送信でアイドル切断を防ぐ（送信毎にアイドル更新）
          pingInterval = setInterval(() => {
            if (!abortController?.signal.aborted) {
              controller.enqueue(sendPing());
              resetIdleTimeout();
            }
          }, 20000);

          resetIdleTimeout();

          // モデル設定の解決（constantsの設定を優先）
          const cfg = MODEL_CONFIGS[model];
          const resolvedModel =
            cfg && cfg.provider === 'anthropic'
              ? cfg.actualModel
              : model.includes('claude')
                ? model
                : 'claude-sonnet-4-5-20250929';
          const resolvedMaxTokens = cfg && cfg.provider === 'anthropic' ? cfg.maxTokens : 6000;
          const resolvedTemperature = cfg && cfg.provider === 'anthropic' ? cfg.temperature : 0.3;

          const systemPrompt = systemPromptOverride?.trim()
            ? systemPromptOverride
            : await getSystemPrompt(model, liffAccessToken || undefined, sessionId, serviceId);

          // Web検索ツールの設定
          const streamParams = {
            model: resolvedModel,
            max_tokens: resolvedMaxTokens,
            temperature: resolvedTemperature,
            system: [
              {
                type: 'text' as const,
                text: systemPrompt,
                cache_control: { type: 'ephemeral' as const },
              },
            ],
            messages: anthropicMessages,
            ...(enableWebSearch && {
              tools: [
                {
                  type: 'web_search_20250305' as const,
                  name: 'web_search' as const,
                  max_uses: webSearchConfig.maxUses || 3,
                  ...(webSearchConfig.allowedDomains && {
                    allowed_domains: webSearchConfig.allowedDomains,
                  }),
                  ...(webSearchConfig.blockedDomains && {
                    blocked_domains: webSearchConfig.blockedDomains,
                  }),
                },
              ],
            }),
          };

          const anthropicStream = await anthropic.messages.stream(streamParams, {
            signal: abortController.signal,
          });

          // クライアント切断時のクリーンアップ
          const onAbort = () => {
            if (pingInterval) clearInterval(pingInterval);
            cleanup();
            try {
              controller.close();
            } catch (error) {
              console.warn('[Stream] Failed to close controller:', error);
            }
          };
          req.signal.addEventListener('abort', onAbort);

          for await (const chunk of anthropicStream) {
            if (abortController?.signal.aborted) break;

            resetIdleTimeout();

            // Web検索関連イベントのログ出力（デバッグ用）
            if (chunk.type === 'content_block_start') {
              console.log(
                '[Web Search Debug] content_block_start:',
                JSON.stringify(chunk.content_block)
              );
            }

            if (chunk.type === 'content_block_delta') {
              if (chunk.delta.type === 'text_delta') {
                const textChunk = chunk.delta.text;
                fullMessage += textChunk;
                controller.enqueue(sendSSE('chunk', textChunk));
              }
            } else if (chunk.type === 'message_delta') {
              if (chunk.usage) {
                const usage = {
                  inputTokens: chunk.usage.input_tokens || 0,
                  outputTokens: chunk.usage.output_tokens || 0,
                  totalTokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0),
                };
                controller.enqueue(sendSSE('usage', usage));
              }
            } else if (chunk.type === 'message_stop') {
              // 完了時にメッセージをデータベースに保存
              try {
                const postStreamLimitError = await checkTrialDailyLimit(userRole, userId);
                if (postStreamLimitError) {
                  controller.enqueue(
                    sendSSE('error', { type: 'daily_limit', message: postStreamLimitError })
                  );
                  if (pingInterval) clearInterval(pingInterval);
                  cleanup();
                  controller.close();
                  return;
                }

                let result;
                if (sessionId) {
                  // continueChat は serviceId を受け取らないため、継続時は事前更新で一貫性を保つ
                  if (serviceId) {
                    try {
                      await chatService.updateSessionServiceId(userId, sessionId, serviceId);
                    } catch (updateError) {
                      console.warn('Failed to update session service ID:', updateError);
                    }
                  }

                  result = await chatService.continueChat(
                    userId,
                    sessionId,
                    [userMessage, fullMessage], // 再生成を回避
                    '',
                    [],
                    model
                  );
                } else {
                  result = await chatService.startChat(
                    userId,
                    'あなたは優秀なAIアシスタントです。',
                    [userMessage, fullMessage],
                    model,
                    serviceId
                  );
                }

                controller.enqueue(
                  sendSSE('final', {
                    message: fullMessage,
                    sessionId: result.sessionId || sessionId,
                  })
                );
              } catch (saveError) {
                console.error('Failed to save chat message:', saveError);
                controller.enqueue(
                  sendSSE('error', {
                    type: 'save_failed',
                    message: 'メッセージの保存に失敗しましたが、応答は正常に生成されました',
                  })
                );
              }

              controller.enqueue(sendSSE('done', {}));
              if (pingInterval) clearInterval(pingInterval);
              cleanup();
              controller.close();
              return;
            }
          }

          if (pingInterval) clearInterval(pingInterval);
          cleanup();
          controller.close();
        } catch (error: unknown) {
          if (pingInterval) clearInterval(pingInterval);
          cleanup();

          console.error('Anthropic streaming error:', error);

          // 詳細なAnthropicエラーへマッピング
          const ce = ChatError.fromApiError(error, { provider: 'anthropic' });
          controller.enqueue(
            sendSSE('error', {
              type: ce.code,
              message: ce.userMessage,
            })
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    console.error('Stream setup error:', error);
    return new Response(
      sendSSE('error', {
        type: 'setup_error',
        message: 'ストリーミングの初期化に失敗しました',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
