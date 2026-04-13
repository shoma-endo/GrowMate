import { chatService } from '@/server/services/chatService';
import { llmChat } from '@/server/services/llmService';
import { ChatProcessorService } from './chatProcessors';
import { MODEL_CONFIGS } from '@/lib/constants';
import { getSystemPrompt as getSystemPromptShared } from '@/lib/prompts';
import { ChatResponse } from '@/types/chat';
import type { StartChatInput, ContinueChatInput } from '@/server/schemas/chat.schema';
import { BriefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import type { Service } from '@/server/schemas/brief.schema';

/**
 * モデルに応じた動的プロンプト取得（React Cache活用）
 */
const getSystemPrompt = getSystemPromptShared;

/**
 * serviceIdを検証し、有効なサービスを返すヘルパー関数
 * @param services ユーザーのサービス一覧
 * @param serviceId 検証対象のserviceId
 * @returns 有効なサービス（存在しない場合は最初のサービスにフォールバック）
 */
function resolveTargetService(
  services: Service[] | undefined,
  serviceId: string | undefined
): Service | null {
  if (!services || services.length === 0) {
    return null;
  }

  if (serviceId) {
    const foundService = services.find(s => s.id === serviceId);
    if (foundService) {
      return foundService;
    }
    // serviceIdが指定されているが見つからない場合は警告を出力してフォールバック
    console.warn(
      `[ModelHandler] 指定されたserviceId "${serviceId}" が見つかりません。最初のサービスにフォールバックします。`
    );
  }

  // serviceId未指定または見つからない場合は最初のサービスを返す
  return services[0] ?? null;
}

export class ModelHandlerService {
  private processor = new ChatProcessorService();

  /**
   * LP draft用の変数を構築するヘルパー関数
   * @param userId ユーザーID
   * @param serviceId オプションのサービスID
   * @returns 変数のレコード
   */
  private async buildLPDraftVariables(
    userId: string,
    serviceId?: string
  ): Promise<Record<string, string>> {
    const briefData = await BriefService.getVariablesByUserId(userId).catch((error) => {
      console.warn('[ModelHandler] Brief data fetch failed:', error);
      return null;
    });
    const profileVars = PromptService.buildProfileVariables(briefData?.profile ?? null);
    const targetService = resolveTargetService(briefData?.services, serviceId);
    const serviceVars = PromptService.buildServiceVariables(targetService);
    return {
      ...profileVars,
      ...serviceVars,
      service: serviceVars.serviceName || '',
      persona: briefData?.persona || '',
    };
  }

  async handleStart(userId: string, data: StartChatInput): Promise<ChatResponse> {
    const { userMessage, model, serviceId } = data;
    // キャッシュ戦略を活用した動的プロンプト取得
    const systemPrompt = await getSystemPrompt(model, undefined, undefined, serviceId);

    switch (model) {
      case 'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2':
        return this.handleFTModel(userId, systemPrompt, userMessage, model, serviceId);
      case 'ad_copy_creation':
        return this.handleAdCopyModel(userId, systemPrompt, userMessage, serviceId);
      case 'gpt-4.1-nano':
        return this.handleFinishingModel(userId, systemPrompt, userMessage, serviceId);
      case 'lp_draft_creation':
        return this.handleLPDraftModel(userId, systemPrompt, userMessage, serviceId);
      default:
        return this.handleDefaultModel(userId, systemPrompt, userMessage, model, serviceId);
    }
  }

  async handleContinue(userId: string, data: ContinueChatInput): Promise<ChatResponse> {
    const {
      sessionId,
      messages,
      userMessage,
      model,
      systemPrompt: customSystemPrompt,
      serviceId,
    } = data;
    // カスタムsystemPromptが渡されていればそれを使用、なければキャッシュ戦略を活用した動的プロンプト取得
    const systemPrompt =
      customSystemPrompt ?? (await getSystemPrompt(model, undefined, sessionId, serviceId));

    if (model === 'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2') {
      const config = MODEL_CONFIGS[model];
      const actualModel = config ? config.actualModel : model;
      const temperature = config ? config.temperature : 0.5;
      const maxTokens = config ? config.maxTokens : 1000;

      const chatMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      const aiReply = await llmChat(
        'openai',
        actualModel,
        [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
          { role: 'user', content: userMessage.trim() },
        ],
        { temperature, maxTokens }
      );

      const classificationKeywords = aiReply === '今すぐ客キーワード' ? userMessage : aiReply;
      const { immediate, later } = this.processor.extractKeywordSections(classificationKeywords);

      if (immediate.length === 0) {
        // ユーザー入力 + AI応答を分離して保存
        return await chatService.continueChat(
          userId,
          sessionId,
          [userMessage.trim(), aiReply],
          systemPrompt,
          [],
          model
        );
      }

      const assistantReply = `【今すぐ客キーワード】\n${immediate.join('\n')}\n\n【後から客キーワード】\n${later.join('\n')}`;
      return await chatService.continueChat(
        userId,
        sessionId,
        [userMessage.trim(), assistantReply],
        systemPrompt,
        [],
        model
      );
    } else if (
      model === 'ad_copy_creation' ||
      model === 'ad_copy_finishing' ||
      model === 'lp_improvement'
    ) {
      // ✅ Claudeモデルの履歴引き継ぎ対応
      const validMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      return await chatService.continueChat(
        userId,
        sessionId,
        userMessage,
        systemPrompt,
        validMessages, // 履歴を正しく渡す
        model
      );
    } else if (model === 'lp_draft_creation') {
      const variables = await this.buildLPDraftVariables(userId, serviceId);
      const finalSystemPrompt = PromptService.replaceVariables(systemPrompt, variables);

      const validMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      try {
        return await chatService.continueChat(
          userId,
          sessionId,
          userMessage,
          finalSystemPrompt,
          validMessages,
          'lp_draft_creation'
        );
      } catch (error) {
        console.error('LP継続生成エラー:', error);
        return await chatService.continueChat(
          userId,
          sessionId,
          userMessage,
          systemPrompt,
          validMessages,
          'lp_draft_creation'
        );
      }
    }

    // デフォルト処理: 未対応モデルの場合
    const validMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    return await chatService.continueChat(
      userId,
      sessionId,
      userMessage,
      systemPrompt,
      validMessages,
      model
    );
  }

  private async handleFTModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    model: string,
    serviceId?: string
  ): Promise<ChatResponse> {
    const config = MODEL_CONFIGS[model];
    const maxTokens = config ? config.maxTokens : 1000;
    const temperature = config ? config.temperature : 0.5;

    const aiReply = await llmChat(
      'openai',
      model,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage.trim() },
      ],
      { temperature, maxTokens }
    );

    const classificationKeywords = aiReply === '今すぐ客キーワード' ? userMessage : aiReply;
    const { immediate, later } = this.processor.extractKeywordSections(classificationKeywords);

    if (immediate.length === 0) {
      // ユーザー入力はそのまま、AI応答として分類結果のみを返す
      return await chatService.startChat(
        userId,
        systemPrompt,
        [userMessage.trim(), aiReply],
        model,
        serviceId
      );
    }

    // ユーザー入力はそのまま、AI応答として分類結果を返す
    const assistantReply = `【今すぐ客キーワード】\n${immediate.join('\n')}\n\n【後から客キーワード】\n${later.join('\n')}`;
    return await chatService.startChat(
      userId,
      systemPrompt,
      [userMessage.trim(), assistantReply],
      model,
      serviceId
    );
  }

  private async handleAdCopyModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    serviceId?: string
  ): Promise<ChatResponse> {
    return await chatService.startChat(
      userId,
      systemPrompt,
      userMessage.trim(),
      'ad_copy_creation',
      serviceId
    );
  }

  private async handleFinishingModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    serviceId?: string
  ): Promise<ChatResponse> {
    return await chatService.startChat(
      userId,
      systemPrompt,
      userMessage.trim(),
      'gpt-4.1-nano',
      serviceId
    );
  }

  private async handleLPDraftModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    serviceId?: string
  ): Promise<ChatResponse> {
    const variables = await this.buildLPDraftVariables(userId, serviceId);
    const finalSystemPrompt = PromptService.replaceVariables(systemPrompt, variables);

    try {
      return await chatService.startChat(
        userId,
        finalSystemPrompt,
        userMessage.trim(),
        'lp_draft_creation',
        serviceId
      );
    } catch (error) {
      console.error('LP生成エラー:', error);
      return await chatService.startChat(
        userId,
        systemPrompt,
        userMessage.trim(),
        'lp_draft_creation',
        serviceId
      );
    }
  }

  private async handleDefaultModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    model?: string,
    serviceId?: string
  ): Promise<ChatResponse> {
    return await chatService.startChat(userId, systemPrompt, userMessage.trim(), model, serviceId);
  }

  /**
   * ユーザーメッセージからキーワードを抽出
   */
  private extractKeywordsFromUserMessage(userMessage: string): string[] {
    // 複数の形式に対応したキーワード抽出
    const patterns = [
      /キーワード[:：]\s*(.+)/i,
      /対象キーワード[:：]\s*(.+)/i,
      /分類[:：]\s*(.+)/i,
      /(.+)/, // フォールバック：全体をキーワードとして扱う
    ];

    for (const pattern of patterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        return match[1]
          .split(/[,、\n]/)
          .map(k => k.trim())
          .filter(k => k.length > 0);
      }
    }

    return [];
  }
}
