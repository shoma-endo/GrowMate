/** 日本語混在向け。実測と ±15% 程度ズレうる */
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 1.5;
const TOKEN_ESTIMATE_SAFETY_FACTOR = 1.1;

export const DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS = 15_000;
const REDUCED_KNOWLEDGE_INJECTION_BUDGET_TOKENS = 7_500;

export const KNOWLEDGE_DOC_HARD_REJECT_CHARS_PER_DOC = 50_000;
export const KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL = 150_000;

const STEP7_INPUT_GUARD_REDUCE_TOKENS = 40_000;
const STEP7_INPUT_GUARD_SKIP_TOKENS = 60_000;

const DOC_BOUNDARY_SEPARATOR = '\n\n---\n\n';

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN) * TOKEN_ESTIMATE_SAFETY_FACTOR);
}

export function trimKnowledgeForGeneration(
  mergedContent: string,
  budgetTokens: number = DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS
): string {
  const trimmedInput = mergedContent.trim();
  if (!trimmedInput) return '';

  if (estimateTextTokens(trimmedInput) <= budgetTokens) {
    return trimmedInput;
  }

  const docParts = trimmedInput.split(DOC_BOUNDARY_SEPARATOR);
  let result = '';
  let usedTokens = 0;

  for (let index = 0; index < docParts.length; index += 1) {
    const part = docParts[index]?.trim();
    if (!part) continue;

    const partTokens = estimateTextTokens(part);
    const separator = result ? DOC_BOUNDARY_SEPARATOR : '';
    const separatorTokens = separator ? estimateTextTokens(separator) : 0;

    if (usedTokens + separatorTokens + partTokens <= budgetTokens) {
      result += `${separator}${part}`;
      usedTokens += separatorTokens + partTokens;
      continue;
    }

    const remainingTokens = budgetTokens - usedTokens - separatorTokens;
    if (remainingTokens <= 0) break;

    const partial = trimTextToTokenBudget(part, remainingTokens);
    if (partial) {
      result += `${separator}${partial}`;
      console.warn('[KnowledgeBudget] trimKnowledgeForGeneration truncated content', {
        budgetTokens,
        originalTokens: estimateTextTokens(trimmedInput),
        keptTokens: estimateTextTokens(result),
      });
    }
    break;
  }

  return result.trim();
}

function trimTextToTokenBudget(text: string, budgetTokens: number): string {
  if (budgetTokens <= 0 || !text) return '';

  let low = 0;
  let high = text.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd();
    if (!candidate) {
      low = mid + 1;
      continue;
    }

    if (estimateTextTokens(candidate) <= budgetTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export interface RequestInputTokenEstimateParams {
  systemBlocks: { knowledgeBlock: string; templateBlock: string };
  historySummary?: string;
  recentMessages?: { content: string }[];
  userMessage?: string;
  editorBody?: string;
}

export function estimateRequestInputTokens(params: RequestInputTokenEstimateParams): number {
  const parts = [
    params.systemBlocks.knowledgeBlock,
    params.systemBlocks.templateBlock,
    params.historySummary ?? '',
    ...(params.recentMessages ?? []).map(message => message.content),
    params.userMessage ?? '',
    params.editorBody ?? '',
  ];

  return parts.reduce((total, part) => total + estimateTextTokens(part), 0);
}

export function resolveKnowledgeBudgetTokens(
  estimatedInputTokens: number,
  modelKey: string
): number | null {
  const isStep7Like =
    modelKey === 'blog_creation_step7' || /^blog_creation_step7_h\d+/.test(modelKey);

  if (!isStep7Like) {
    return DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS;
  }

  if (estimatedInputTokens > STEP7_INPUT_GUARD_SKIP_TOKENS) {
    console.warn('[KnowledgeBudget] L1 injection skipped due to input guard', {
      modelKey,
      estimatedInputTokens,
      threshold: STEP7_INPUT_GUARD_SKIP_TOKENS,
    });
    return null;
  }

  if (estimatedInputTokens > STEP7_INPUT_GUARD_REDUCE_TOKENS) {
    console.warn('[KnowledgeBudget] L1 budget reduced due to input guard', {
      modelKey,
      estimatedInputTokens,
      threshold: STEP7_INPUT_GUARD_REDUCE_TOKENS,
      budgetTokens: REDUCED_KNOWLEDGE_INJECTION_BUDGET_TOKENS,
    });
    return REDUCED_KNOWLEDGE_INJECTION_BUDGET_TOKENS;
  }

  return DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS;
}
