import { defineCronDefinitions } from '@/server/lib/cron-observability';

export const CRON_CONFIGS = {
  gscEvaluate: {
    name: 'gsc_evaluate',
    workflowId: 'gsc-evaluate',
    routePath: '/api/cron/gsc-evaluate',
    profile: 'gsc-batch',
    maxDuration: 300,
    maxTime: 310,
    maxRetries: 3,
  },
  gscSuggestions: {
    name: 'gsc_suggestions',
    workflowId: 'gsc-suggestions',
    routePath: '/api/cron/gsc-suggestions',
    profile: 'gsc-suggestions',
    maxDuration: 300,
    maxTime: 310,
    maxRetries: 3,
  },
  googleAdsNegativeKeywords: {
    name: 'google_ads_negative_keywords',
    workflowId: 'google-ads-negative-keywords',
    routePath: '/api/cron/google-ads-negative-keywords-suggestion',
    profile: 'count-batch',
    maxDuration: 800,
    maxTime: 820,
    maxRetries: 1,
  },
  ga4ContentEvaluate: {
    name: 'ga4_content_evaluate',
    workflowId: 'ga4-content-evaluate',
    routePath: '/api/cron/ga4-content-evaluate',
    profile: 'count-batch',
    maxDuration: 300,
    maxTime: 310,
    // メール送信バッチのため再実行しない（hourly-cron.yml:7。§8.3）
    maxRetries: 1,
  },
} as const;

export const CRON_DEFINITIONS = defineCronDefinitions(CRON_CONFIGS);
