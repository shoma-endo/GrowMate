import 'server-only';

import {
  DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS,
  estimateRequestInputTokens,
  resolveKnowledgeBudgetTokens,
  trimKnowledgeForGeneration,
  type RequestInputTokenEstimateParams,
} from '@/lib/knowledgeBudget';
import {
  KNOWLEDGE_SOURCE_OVERRIDE_BUDGET_TOKENS,
  normalizeKnowledgeSourceOverrideText,
  validateKnowledgeSourceOverrideText,
} from '@/lib/knowledgeSourceOverride';
import { KnowledgeSourceService } from '@/server/services/knowledgeSourceService';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';

const KNOWLEDGE_INJECTION_MODEL_KEYS = new Set([
  'ad_copy_creation',
  'lp_draft_creation',
  'blog_title_meta_generation',
  'blog_creation_step1',
  'blog_creation_step2',
  'blog_creation_step3',
  'blog_creation_step4',
  'blog_creation_step5',
  'blog_creation_step6',
  'blog_creation_step7',
  'blog_creation_step7_heading',
]);

type KnowledgeSystemBlocks = {
  knowledgeBlock: string;
  templateBlock: string;
};

export type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

function isKnowledgeInjectionModel(modelKey: string): boolean {
  if (KNOWLEDGE_INJECTION_MODEL_KEYS.has(modelKey)) return true;
  if (/^blog_creation_step7_h\d+/.test(modelKey)) return true;
  if (/^blog_creation_step6_/.test(modelKey)) return true;
  return false;
}

async function buildKnowledgeSystemBlocks(
  templateBlock: string,
  options?: { budgetTokens?: number; knowledgeOverrideText?: string }
): Promise<KnowledgeSystemBlocks> {
  const overrideText = normalizeKnowledgeSourceOverrideText(options?.knowledgeOverrideText);
  const overrideError = overrideText ? validateKnowledgeSourceOverrideText(overrideText) : null;
  if (overrideError) {
    throw new Error(overrideError);
  }

  const raw = overrideText || (await KnowledgeSourceService.getGlobalKnowledgeContent());
  const defaultBudgetTokens = overrideText
    ? KNOWLEDGE_SOURCE_OVERRIDE_BUDGET_TOKENS
    : DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS;
  const hot = trimKnowledgeForGeneration(
    raw,
    options?.budgetTokens ?? defaultBudgetTokens
  );

  if (!hot.trim()) {
    return { knowledgeBlock: '', templateBlock };
  }

  const knowledgeBlock = [
    '## カオルさんの考え方・ノウハウ（有料 Pro ユーザー共通）',
    '',
    hot.trim(),
  ].join('\n');

  return { knowledgeBlock, templateBlock };
}

async function buildKnowledgeSystemBlocksForRequest(
  templateBlock: string,
  options: {
    modelKey: string;
    userRole: UserRole;
    budgetTokens?: number;
    knowledgeOverrideText?: string;
  }
): Promise<KnowledgeSystemBlocks> {
  if (!hasPaidFeatureAccess(options.userRole)) {
    return { knowledgeBlock: '', templateBlock };
  }

  if (!isKnowledgeInjectionModel(options.modelKey)) {
    return { knowledgeBlock: '', templateBlock };
  }

  if (options.budgetTokens !== undefined) {
    return buildKnowledgeSystemBlocks(templateBlock, {
      budgetTokens: options.budgetTokens,
      ...(options.knowledgeOverrideText
        ? { knowledgeOverrideText: options.knowledgeOverrideText }
        : {}),
    });
  }

  return buildKnowledgeSystemBlocks(templateBlock, {
    ...(options.knowledgeOverrideText ? { knowledgeOverrideText: options.knowledgeOverrideText } : {}),
  });
}

function toAnthropicSystemBlocks(blocks: KnowledgeSystemBlocks): AnthropicSystemBlock[] {
  if (!blocks.knowledgeBlock.trim()) {
    return [{ type: 'text', text: blocks.templateBlock }];
  }

  return [
    {
      type: 'text',
      text: blocks.knowledgeBlock,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: blocks.templateBlock },
  ];
}

export async function resolveKnowledgeBlocksForRequest(
  templateBlock: string,
  options: {
    modelKey: string;
    userRole: UserRole;
    inputEstimate?: Omit<RequestInputTokenEstimateParams, 'systemBlocks'>;
    knowledgeOverrideText?: string;
  }
): Promise<{ blocks: KnowledgeSystemBlocks; anthropicSystem: AnthropicSystemBlock[] }> {
  const overrideText = normalizeKnowledgeSourceOverrideText(options.knowledgeOverrideText);
  const preliminaryBlocks = await buildKnowledgeSystemBlocksForRequest(templateBlock, {
    modelKey: options.modelKey,
    userRole: options.userRole,
    ...(overrideText ? { knowledgeOverrideText: overrideText } : {}),
  });

  const estimateParams: RequestInputTokenEstimateParams = {
    systemBlocks: preliminaryBlocks,
    ...options.inputEstimate,
  };

  const budgetTokens = overrideText
    ? KNOWLEDGE_SOURCE_OVERRIDE_BUDGET_TOKENS
    : resolveKnowledgeBudgetTokens(estimateRequestInputTokens(estimateParams), options.modelKey);

  let blocks: KnowledgeSystemBlocks;
  if (budgetTokens === null) {
    blocks = { knowledgeBlock: '', templateBlock };
  } else if (
    budgetTokens === DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS &&
    preliminaryBlocks.knowledgeBlock.trim()
  ) {
    blocks = preliminaryBlocks;
  } else {
    blocks = await buildKnowledgeSystemBlocksForRequest(templateBlock, {
      modelKey: options.modelKey,
      userRole: options.userRole,
      budgetTokens,
      ...(overrideText ? { knowledgeOverrideText: overrideText } : {}),
    });
  }

  return {
    blocks,
    anthropicSystem: toAnthropicSystemBlocks(blocks),
  };
}

export function appendHistorySummaryToAnthropicSystem(
  anthropicSystem: AnthropicSystemBlock[],
  historySummary: string
): AnthropicSystemBlock[] {
  const trimmedSummary = historySummary.trim();
  if (!trimmedSummary || anthropicSystem.length === 0) {
    return anthropicSystem;
  }

  const lastIndex = anthropicSystem.length - 1;
  const lastBlock = anthropicSystem[lastIndex];
  if (!lastBlock) return anthropicSystem;

  const updated = [...anthropicSystem];
  updated[lastIndex] = {
    ...lastBlock,
    text: `${lastBlock.text}\n\n【直前までの会話要約】\n${trimmedSummary}`,
  };
  return updated;
}
