import { logger } from '@/server/lib/logger';

interface AnthropicTokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
  server_tool_use?: {
    web_search_requests?: number | null;
  } | null;
}

interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreationEphemeral5mInputTokens: number;
  cacheCreationEphemeral1hInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
}

const OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD = {
  input: 5,
  output: 25,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
  cacheRead: 0.5,
} as const;

const WEB_SEARCH_PRICE_PER_REQUEST_USD = 0.01;

export const createEmptyTokenUsageTotals = (): TokenUsageTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreationEphemeral5mInputTokens: 0,
  cacheCreationEphemeral1hInputTokens: 0,
  cacheReadInputTokens: 0,
  webSearchRequests: 0,
});

/**
 * Anthropic のストリーミング usage は累積値として届くため、各フィールドは最大値で取り込む。
 */
export const mergeTokenUsage = (
  current: TokenUsageTotals,
  usage: AnthropicTokenUsage | undefined
): TokenUsageTotals => {
  if (!usage) return current;

  return {
    inputTokens: Math.max(current.inputTokens, usage.input_tokens ?? 0),
    outputTokens: Math.max(current.outputTokens, usage.output_tokens ?? 0),
    cacheCreationInputTokens: Math.max(
      current.cacheCreationInputTokens,
      usage.cache_creation_input_tokens ?? 0
    ),
    cacheCreationEphemeral5mInputTokens: Math.max(
      current.cacheCreationEphemeral5mInputTokens,
      usage.cache_creation?.ephemeral_5m_input_tokens ?? 0
    ),
    cacheCreationEphemeral1hInputTokens: Math.max(
      current.cacheCreationEphemeral1hInputTokens,
      usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
    ),
    cacheReadInputTokens: Math.max(current.cacheReadInputTokens, usage.cache_read_input_tokens ?? 0),
    webSearchRequests: Math.max(
      current.webSearchRequests,
      usage.server_tool_use?.web_search_requests ?? 0
    ),
  };
};

export const addTokenUsageTotals = (
  current: TokenUsageTotals,
  usage: TokenUsageTotals
): TokenUsageTotals => ({
  inputTokens: current.inputTokens + usage.inputTokens,
  outputTokens: current.outputTokens + usage.outputTokens,
  cacheCreationInputTokens: current.cacheCreationInputTokens + usage.cacheCreationInputTokens,
  cacheCreationEphemeral5mInputTokens:
    current.cacheCreationEphemeral5mInputTokens + usage.cacheCreationEphemeral5mInputTokens,
  cacheCreationEphemeral1hInputTokens:
    current.cacheCreationEphemeral1hInputTokens + usage.cacheCreationEphemeral1hInputTokens,
  cacheReadInputTokens: current.cacheReadInputTokens + usage.cacheReadInputTokens,
  webSearchRequests: current.webSearchRequests + usage.webSearchRequests,
});

const getCacheCreationInputTokens = (usage: TokenUsageTotals) => {
  const cacheCreationByTtl =
    usage.cacheCreationEphemeral5mInputTokens + usage.cacheCreationEphemeral1hInputTokens;
  return cacheCreationByTtl > 0 ? cacheCreationByTtl : usage.cacheCreationInputTokens;
};

const calculateOpus47EquivalentCostUsd = (usage: TokenUsageTotals) => {
  const hasCacheCreationByTtl =
    usage.cacheCreationEphemeral5mInputTokens + usage.cacheCreationEphemeral1hInputTokens > 0;
  const cacheWriteCost = hasCacheCreationByTtl
    ? (usage.cacheCreationEphemeral5mInputTokens / 1_000_000) *
        OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.cacheWrite5m +
      (usage.cacheCreationEphemeral1hInputTokens / 1_000_000) *
        OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.cacheWrite1h
    : (usage.cacheCreationInputTokens / 1_000_000) *
      OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.cacheWrite5m;
  const inputCost =
    (usage.inputTokens / 1_000_000) * OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.input;
  const outputCost =
    (usage.outputTokens / 1_000_000) * OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.output;
  const cacheReadCost =
    (usage.cacheReadInputTokens / 1_000_000) *
    OPUS_4_7_PRICE_PER_MILLION_TOKENS_USD.cacheRead;
  const webSearchCost = usage.webSearchRequests * WEB_SEARCH_PRICE_PER_REQUEST_USD;

  return {
    inputCostUsd: Number(inputCost.toFixed(8)),
    outputCostUsd: Number(outputCost.toFixed(8)),
    cacheWriteCostUsd: Number(cacheWriteCost.toFixed(8)),
    cacheReadCostUsd: Number(cacheReadCost.toFixed(8)),
    webSearchCostUsd: Number(webSearchCost.toFixed(8)),
    totalCostUsd: Number(
      (inputCost + outputCost + cacheWriteCost + cacheReadCost + webSearchCost).toFixed(8)
    ),
  };
};

export const getTotalTokens = (usage: TokenUsageTotals) =>
  usage.inputTokens +
  usage.outputTokens +
  getCacheCreationInputTokens(usage) +
  usage.cacheReadInputTokens;

export const logTokenUsage = (usage: TokenUsageTotals) => {
  logger.info('[Chat Token Usage]', {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheCreationEphemeral5mInputTokens: usage.cacheCreationEphemeral5mInputTokens,
    cacheCreationEphemeral1hInputTokens: usage.cacheCreationEphemeral1hInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    webSearchRequests: usage.webSearchRequests,
    totalTokens: getTotalTokens(usage),
    opus47EquivalentCostUsd: calculateOpus47EquivalentCostUsd(usage),
  });
};
