import { NextRequest } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { chatService } from '@/server/services/chatService';
import { headingFlowService } from '@/server/services/headingFlowService';
import { env } from '@/env';
import {
  MODEL_CONFIGS,
  STEP7_BLOG_MODEL,
  STEP7_FULL_BODY_TRIGGER,
  STEP7_HEADING_CONFIG_KEY,
  isStep7HeadingModel,
} from '@/lib/constants';

import { ChatError } from '@/domain/errors/ChatError';
import { getResponseModelForBlogCreation } from '@/lib/canvas-content';
import { getSystemPrompt } from '@/lib/prompts';
import { checkTrialDailyLimit } from '@/server/services/chatLimitService';
import type { UserRole } from '@/types/user';
import { VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { hasOwnerRole } from '@/authUtils';

export const runtime = 'nodejs';
export const maxDuration = 800;

interface StreamRequest {
  sessionId?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  model: string;
  systemPrompt?: string;
  serviceId?: string;
  /** 本文生成ボタン用: blog_creation_step7 の応答を session_combined_contents に保存 */
  step7FullBodyGeneration?: boolean;
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
      step7FullBodyGeneration = false,
      enableWebSearch = false,
      webSearchConfig = {},
    }: StreamRequest = await req.json();

    const isStep7Model = model === STEP7_BLOG_MODEL;

    // 認証チェック
    const authHeader = req.headers.get('authorization');
    const liffAccessToken = authHeader?.replace('Bearer ', '');

    const authResult = await authMiddleware(liffAccessToken, undefined, { allowEmailFallback: true });
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

    // step7 本文生成: 閲覧専用オーナーは書き込み不可
    if (
      step7FullBodyGeneration &&
      isStep7Model &&
      hasOwnerRole(userDetails?.role ?? null)
    ) {
      return new Response(
        sendSSE('error', {
          type: 'forbidden',
          message: '閲覧専用ユーザーは完成形の保存ができません',
        }),
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

    // Step7 完成形は Canvas 側の全文を正本とし、追加コンテキストは注入しない。
    const effectiveUserMessage =
      step7FullBodyGeneration && isStep7Model
        ? STEP7_FULL_BODY_TRIGGER
        : combinedUserMessage;

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
      { role: 'user' as const, content: effectiveUserMessage },
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

          // step7 見出しモデル（step7_h0 等）は見出し単体生成用（maxTokens: 3000）。
          // step7 本文生成（完成形）は blog_creation_step7（maxTokens: 25000）。
          const configKey =
            Object.prototype.hasOwnProperty.call(MODEL_CONFIGS, model)
              ? model
              : isStep7HeadingModel(model)
                ? STEP7_HEADING_CONFIG_KEY
                : model;
          const cfg = MODEL_CONFIGS[configKey];
          const resolvedModel =
            cfg && cfg.provider === 'anthropic'
              ? cfg.actualModel
              : model.includes('claude')
                ? model
                : 'claude-sonnet-4-6';
          const resolvedMaxTokens = cfg && cfg.provider === 'anthropic' ? cfg.maxTokens : 6000;
          const resolvedTemperature = cfg && cfg.provider === 'anthropic' ? cfg.temperature : 0.3;

          const systemPrompt = systemPromptOverride?.trim()
            ? systemPromptOverride
            : await getSystemPrompt(
                model,
                liffAccessToken ?? '',
                sessionId,
                serviceId
              );

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
                  max_uses: webSearchConfig.maxUses ?? 3,
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
              // 完了時: 全ステップ共通の保存フロー。いずれか失敗したら error を返し、成功時のみ final → done を送る。
              const messageToSave = fullMessage;
              const saveModel = getResponseModelForBlogCreation(model);

              const sendSaveErrorAndExit = (type: string, message: string) => {
                controller.enqueue(sendSSE('error', { type, message }));
                if (pingInterval) clearInterval(pingInterval);
                cleanup();
                controller.close();
              };

              try {
                const postStreamLimitError = await checkTrialDailyLimit(userRole, userId);
                if (postStreamLimitError) {
                  sendSaveErrorAndExit('daily_limit', postStreamLimitError);
                  return;
                }

                let result;
                if (sessionId) {
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
                    [effectiveUserMessage, messageToSave],
                    '',
                    [],
                    saveModel
                  );
                } else {
                  result = await chatService.startChat(
                    userId,
                    'あなたは優秀なAIアシスタントです。',
                    [effectiveUserMessage, messageToSave],
                    saveModel,
                    serviceId
                  );
                }

                const effectiveSessionId = result?.sessionId ?? sessionId ?? undefined;

                // step7 本文生成のみ: session_combined_contents に追加保存。閲覧専用オーナーは拒否
                const needsStep7CombinedSave =
                  step7FullBodyGeneration &&
                  isStep7Model &&
                  effectiveSessionId &&
                  messageToSave.trim();
                if (needsStep7CombinedSave) {
                  if (hasOwnerRole(userDetails?.role ?? null)) {
                    sendSaveErrorAndExit(
                      'forbidden',
                      '閲覧専用ユーザーは完成形の保存ができません'
                    );
                    return;
                  }
                  const snapRes = await headingFlowService.saveCombinedContentSnapshot(
                    effectiveSessionId,
                    messageToSave,
                    userId
                  );
                  if (!snapRes.success) {
                    console.error('[Stream] saveCombinedContentSnapshot failed:', snapRes.error);
                    sendSaveErrorAndExit(
                      'save_failed',
                      '完成形の保存に失敗しました。チャットには表示されていますが、Canvas のバージョン管理には反映されていません。'
                    );
                    return;
                  }
                }

                controller.enqueue(
                  sendSSE('final', {
                    message: messageToSave,
                    sessionId: result.sessionId || sessionId,
                  })
                );
              } catch (saveError) {
                console.error('Failed to save chat message:', saveError);
                sendSaveErrorAndExit(
                  'save_failed',
                  'メッセージの保存に失敗しましたが、応答は正常に生成されました'
                );
                return;
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
