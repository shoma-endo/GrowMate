import { defineCronDefinitions } from '@/server/lib/cron-observability';

export const CRON_CONFIGS = {
  gscDailyImport: {
    name: 'gsc_daily_import',
    workflowId: 'gsc-daily-import',
    routePath: '/api/cron/gsc-daily-import',
    schedule: '5 19 * * *',
    profile: 'count-batch',
    maxDuration: 800,
    maxTime: 820,
    maxRetries: 1,
  },
  ga4DailySync: {
    name: 'ga4_daily_sync',
    workflowId: 'ga4-daily-sync',
    routePath: '/api/cron/ga4-daily-sync',
    schedule: '25 19 * * *',
    profile: 'count-batch',
    maxDuration: 800,
    maxTime: 820,
    maxRetries: 1,
  },
  wordpressDailyImport: {
    name: 'wordpress_daily_import',
    workflowId: 'wordpress-daily-import',
    routePath: '/api/cron/wordpress-daily-import',
    schedule: '45 19 * * *',
    profile: 'count-batch',
    maxDuration: 1800,
    maxTime: 1820,
    maxRetries: 1,
  },
  gscEvaluate: {
    name: 'gsc_evaluate',
    workflowId: 'gsc-evaluate',
    routePath: '/api/cron/gsc-evaluate',
    schedule: '0 * * * *',
    profile: 'gsc-batch',
    maxDuration: 300,
    maxTime: 310,
    maxRetries: 3,
  },
  gscSuggestions: {
    name: 'gsc_suggestions',
    workflowId: 'gsc-suggestions',
    routePath: '/api/cron/gsc-suggestions',
    schedule: '0 * * * *',
    profile: 'gsc-suggestions',
    maxDuration: 300,
    maxTime: 310,
    maxRetries: 3,
  },
  googleAdsNegativeKeywords: {
    name: 'google_ads_negative_keywords',
    workflowId: 'google-ads-negative-keywords',
    routePath: '/api/cron/google-ads-negative-keywords-suggestion',
    schedule: '0 * * * *',
    profile: 'count-batch',
    maxDuration: 800,
    maxTime: 820,
    maxRetries: 1,
  },
  contentAnnotationSummary: {
    name: 'content_annotation_summary',
    workflowId: 'content-annotation-summary',
    routePath: '/api/cron/content-annotation-summary',
    schedule: '*/10 * * * *',
    // 件数集計＋メール送信型なので既存の count-batch を流用する（新規 profile は作らない）
    profile: 'count-batch',
    maxDuration: 800,
    maxTime: 820,
    // メール送信バッチのため再実行しない。既定の3にすると 504（maxDuration 超過）で
    // リトライが走り、同じジョブが並走して二重課金・メール重複を招く
    maxRetries: 1,
  },
  ga4ContentEvaluate: {
    name: 'ga4_content_evaluate',
    workflowId: 'ga4-content-evaluate',
    routePath: '/api/cron/ga4-content-evaluate',
    schedule: '0 * * * *',
    profile: 'count-batch',
    maxDuration: 300,
    maxTime: 310,
    // メール送信バッチのため再実行しない（hourly-cron.yml:7。§8.3）
    maxRetries: 1,
  },
} as const;

export const CRON_DEFINITIONS = defineCronDefinitions(CRON_CONFIGS);
