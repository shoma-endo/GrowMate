import {
  DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS,
  KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL,
  KNOWLEDGE_DOC_WARN_CHARS,
  estimateTextTokens,
} from '@/lib/knowledgeBudget';

export const GLOBAL_KNOWLEDGE_SOURCE_NAME = 'global_knowledge_source';

export function validateGlobalKnowledgeContent(content: string): string | null {
  if (content.length > KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL) {
    return `共通プロンプトは ${KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL.toLocaleString()} 字以内にしてください（現在 ${content.length.toLocaleString()} 字）`;
  }
  return null;
}

export function getGlobalKnowledgeContentStats(content: string): {
  charCount: number;
  estimatedTokens: number;
  isWarnChars: boolean;
  budgetTokens: number;
} {
  return {
    charCount: content.length,
    estimatedTokens: estimateTextTokens(content),
    isWarnChars: content.length > KNOWLEDGE_DOC_WARN_CHARS,
    budgetTokens: DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS,
  };
}
