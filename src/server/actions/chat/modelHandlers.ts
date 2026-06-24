import { chatService } from '@/server/services/chatService';
import { llmChat } from '@/server/services/llmService';
import { ChatProcessorService } from './chatProcessors';
import { MODEL_CONFIGS } from '@/lib/constants';
import { getSystemPrompt as getSystemPromptShared } from '@/lib/prompts';
import { ChatResponse } from '@/types/chat';
import type { StartChatInput, ContinueChatInput } from '@/server/schemas/chat.schema';
import { briefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import type { Service } from '@/server/schemas/brief.schema';
import type { UserRole } from '@/types/user';
import { resolveKnowledgeBlocksForRequest } from '@/lib/knowledgeInjection';

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
    const briefData = await briefService.getVariablesByUserId(userId).catch((error) => {
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

  private async buildKnowledgeAwareSystemPrompt(
    templateBlock: string,
    modelKey: string,
    userRole: UserRole,
    inputEstimate?: {
      recentMessages?: { content: string }[];
      userMessage?: string;
    },
    knowledgeSourceOverrideText?: string
  ) {
    const resolved = await resolveKnowledgeBlocksForRequest(templateBlock, {
      modelKey,
      userRole,
      ...(inputEstimate ? { inputEstimate } : {}),
      ...(knowledgeSourceOverrideText ? { knowledgeOverrideText: knowledgeSourceOverrideText } : {}),
    });

    return {
      storageSystemPrompt: resolved.blocks.templateBlock,
      anthropicSystemBlocks: resolved.anthropicSystem,
    };
  }

  async handleStart(
    userId: string,
    data: StartChatInput,
    userRole: UserRole
  ): Promise<ChatResponse> {
    const { userMessage, model, serviceId, knowledgeSourceOverrideText } = data;
    // キャッシュ戦略を活用した動的プロンプト取得
    const systemPrompt = await getSystemPrompt(model, undefined, undefined, serviceId);

    switch (model) {
      case 'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2':
        return this.handleFTModel(userId, systemPrompt, userMessage, model, serviceId);
      case 'ad_copy_creation':
        return this.handleAdCopyModel(
          userId,
          systemPrompt,
          userMessage,
          serviceId,
          userRole,
          knowledgeSourceOverrideText
        );
      case 'lp_draft_creation':
        return this.handleLPDraftModel(
          userId,
          systemPrompt,
          userMessage,
          serviceId,
          userRole,
          knowledgeSourceOverrideText
        );
      default:
        return this.handleDefaultModel(userId, systemPrompt, userMessage, model, serviceId);
    }
  }

  async handleContinue(
    userId: string,
    data: ContinueChatInput,
    userRole: UserRole
  ): Promise<ChatResponse> {
    const {
      sessionId,
      messages,
      userMessage,
      model,
      systemPrompt: customSystemPrompt,
      serviceId,
      knowledgeSourceOverrideText,
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
    } else if (model === 'ad_copy_creation') {
      const validMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));
      const knowledge = await this.buildKnowledgeAwareSystemPrompt(systemPrompt, model, userRole, {
        recentMessages: validMessages,
        userMessage: userMessage.trim(),
      }, knowledgeSourceOverrideText);

      return await chatService.continueChat(
        userId,
        sessionId,
        userMessage,
        knowledge.storageSystemPrompt,
        validMessages,
        model,
        { anthropicSystemBlocks: knowledge.anthropicSystemBlocks }
      );
    } else if (model === 'lp_draft_creation') {
      const variables = await this.buildLPDraftVariables(userId, serviceId);
      const finalSystemPrompt = PromptService.replaceVariables(systemPrompt, variables);
      const validMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));
      const knowledge = await this.buildKnowledgeAwareSystemPrompt(
        finalSystemPrompt,
        'lp_draft_creation',
        userRole,
        {
          recentMessages: validMessages,
          userMessage: userMessage.trim(),
        },
        knowledgeSourceOverrideText
      );

      return await chatService.continueChat(
        userId,
        sessionId,
        userMessage,
        knowledge.storageSystemPrompt,
        validMessages,
        'lp_draft_creation',
        { anthropicSystemBlocks: knowledge.anthropicSystemBlocks }
      );
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
    serviceId: string | undefined,
    userRole: UserRole,
    knowledgeSourceOverrideText?: string
  ): Promise<ChatResponse> {
    const knowledge = await this.buildKnowledgeAwareSystemPrompt(
      systemPrompt,
      'ad_copy_creation',
      userRole,
      { userMessage: userMessage.trim() },
      knowledgeSourceOverrideText
    );

    return await chatService.startChat(
      userId,
      knowledge.storageSystemPrompt,
      userMessage.trim(),
      'ad_copy_creation',
      serviceId,
      { anthropicSystemBlocks: knowledge.anthropicSystemBlocks }
    );
  }

  private async handleLPDraftModel(
    userId: string,
    systemPrompt: string,
    userMessage: string,
    serviceId: string | undefined,
    userRole: UserRole,
    knowledgeSourceOverrideText?: string
  ): Promise<ChatResponse> {
    const variables = await this.buildLPDraftVariables(userId, serviceId);
    const finalSystemPrompt = PromptService.replaceVariables(systemPrompt, variables);
    const knowledge = await this.buildKnowledgeAwareSystemPrompt(
      finalSystemPrompt,
      'lp_draft_creation',
      userRole,
      { userMessage: userMessage.trim() },
      knowledgeSourceOverrideText
    );

    return await chatService.startChat(
      userId,
      knowledge.storageSystemPrompt,
      userMessage.trim(),
      'lp_draft_creation',
      serviceId,
      { anthropicSystemBlocks: knowledge.anthropicSystemBlocks }
    );
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
}
