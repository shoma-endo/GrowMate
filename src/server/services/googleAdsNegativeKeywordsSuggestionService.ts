import { randomUUID } from 'node:crypto';
import { marked } from 'marked';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { llmChat } from '@/server/services/llmService';
import { briefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { EmailService, emailService as defaultEmailService } from '@/server/services/emailService';
import type {
  GoogleAdsNegativeKeyword,
  GoogleAdsSearchTermMetric,
} from '@/types/googleAds.types';
import type {
  GoogleAdsNegativeKeywordsSuggestionBatchResult,
  GoogleAdsNegativeKeywordsSuggestionResult,
  StructuredNegativeKeywordSuggestion,
} from '@/types/google-ads-negative-keywords-suggestion';

const DEFAULT_SEND_HOUR_JST = 7;
const CRON_CONCURRENCY = 3;
const STRUCTURED_JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)```/i;

function buildPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
}

function sanitizeEmailHtml(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
    .replace(/<\/?(iframe|object|embed|form|input|button)[^>]*>/gi, '');
}

function getJstHour(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);

  return Number(hour);
}

function getJstYesterdayDateISO(date: Date): string {
  return addDaysISO(formatJstDateISO(date), -1);
}

function createSuggestionId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
}

function isSuggestionObject(value: unknown): value is Omit<StructuredNegativeKeywordSuggestion, 'suggestionId'> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'searchTerm' in value &&
      typeof (value as { searchTerm?: unknown }).searchTerm === 'string'
  );
}

function extractStructuredOutput(rawOutput: string): {
  markdown: string;
  suggestions: StructuredNegativeKeywordSuggestion[];
} {
  const match = rawOutput.match(STRUCTURED_JSON_BLOCK_REGEX);
  if (!match?.[1]) {
    return { markdown: rawOutput, suggestions: [] };
  }

  const markdown = rawOutput.replace(STRUCTURED_JSON_BLOCK_REGEX, '').trim();
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { markdown, suggestions: [] };
    }

    return {
      markdown,
      suggestions: parsed.filter(isSuggestionObject).map(item => ({
        suggestionId: createSuggestionId(),
        ...item,
      })),
    };
  } catch (error) {
    console.warn('[GoogleAdsNegativeKeywordsSuggestionService] Failed to parse structured JSON:', error);
    return { markdown, suggestions: [] };
  }
}

class GoogleAdsNegativeKeywordsSuggestionService {
  private readonly supabaseService: SupabaseService;
  private readonly googleAdsService: GoogleAdsService;
  private readonly emailService: EmailService;

  constructor(
    supabaseService?: SupabaseService,
    googleAdsService?: GoogleAdsService,
    emailService?: EmailService
  ) {
    this.supabaseService = supabaseService ?? new SupabaseService();
    this.googleAdsService = googleAdsService ?? new GoogleAdsService();
    this.emailService = emailService ?? defaultEmailService;
  }

  async sendNegativeKeywordsSuggestionForUser(
    userId: string,
    options?: {
      force?: boolean;
      dateRangeDays?: number;
    }
  ): Promise<GoogleAdsNegativeKeywordsSuggestionResult> {
    const executedAt = new Date();
    const todayJst = formatJstDateISO(executedAt);
    const yesterdayJst = getJstYesterdayDateISO(executedAt);
    const force = options?.force === true;

    try {
      const userResult = await this.supabaseService.getUserById(userId);
      if (!userResult.success || !userResult.data) {
        return { success: false, error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND };
      }

      const userEmail = userResult.data.email;
      if (!userEmail) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_NEGATIVE_KEYWORDS_SUGGESTION,
        };
      }

      const credential = await this.supabaseService.getGoogleAdsCredential(userId);
      if (!credential) {
        return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.NOT_CONNECTED };
      }
      if (!credential.customerId) {
        return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED };
      }

      const settings = await this.ensureSettings(userId);
      if (!settings) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_NOT_FOUND,
        };
      }
      if (!force && !settings.enabled) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_DISABLED,
        };
      }

      const fail = async (error: string): Promise<GoogleAdsNegativeKeywordsSuggestionResult> => {
        if (!force) {
          await this.markFailure(userId, error);
        }
        return { success: false, error };
      };

      const dateRangeDays = options?.dateRangeDays ?? 1;
      const startDate = dateRangeDays > 1 ? addDaysISO(yesterdayJst, -(dateRangeDays - 1)) : yesterdayJst;
      const endDate = yesterdayJst;
      const useMockGoogleAds =
        process.env.NODE_ENV === 'development' && process.env.MOCK_GOOGLE_ADS_API === 'true';

      let searchTerms: GoogleAdsSearchTermMetric[];
      let negativeKeywords: GoogleAdsNegativeKeyword[];
      let brief: Awaited<ReturnType<typeof briefService.getVariablesByUserId>>;
      let customerName: string | null;

      if (useMockGoogleAds) {
        brief = await briefService.getVariablesByUserId(userId);
        searchTerms = DEV_SAMPLE_SEARCH_TERMS;
        negativeKeywords = DEV_SAMPLE_NEGATIVE_KEYWORDS;
        customerName = 'サンプル株式会社（開発用）';
      } else {
        const accessToken = await this.ensureAccessToken(userId, credential);
        if (!accessToken) {
          return fail(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
        }

        const [searchTermResult, negativeKeywordResult, briefResult, customerNameResult] =
          await Promise.all([
            this.googleAdsService.getSearchTermMetrics({
              accessToken,
              customerId: credential.customerId,
              startDate,
              endDate,
              ...(credential.managerCustomerId && {
                loginCustomerId: credential.managerCustomerId,
              }),
            }),
            this.googleAdsService.getNegativeKeywords({
              accessToken,
              customerId: credential.customerId,
              ...(credential.managerCustomerId && {
                loginCustomerId: credential.managerCustomerId,
              }),
            }),
            briefService.getVariablesByUserId(userId),
            this.resolveCustomerName({
              accessToken,
              customerId: credential.customerId,
              managerCustomerId: credential.managerCustomerId,
            }),
          ]);

        if (!searchTermResult.success) {
          return fail(
            searchTermResult.error ?? ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED
          );
        }
        if (!negativeKeywordResult.success) {
          return fail(
            negativeKeywordResult.error ??
              ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_FETCH_FAILED
          );
        }

        searchTerms = searchTermResult.data ?? [];
        negativeKeywords = negativeKeywordResult.data ?? [];
        brief = briefResult;
        customerName = customerNameResult;
      }

      const totalImpressions = searchTerms.reduce((sum, item) => sum + item.impressions, 0);
      if (totalImpressions === 0) {
        if (!force) {
          await this.markSuccess(userId, todayJst);
        }
        return {
          success: true,
          skipped: true,
          message: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_NO_DATA,
        };
      }

      const promptTemplate = await PromptService.getTemplateByName(
        'google_ads_negative_keywords_suggestion'
      );
      if (!promptTemplate) {
        return fail(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_PROMPT_NOT_FOUND);
      }

      const filledPrompt = buildPrompt(promptTemplate.content, {
        persona: brief?.persona?.trim() || '（ペルソナ未設定）',
        customerName: customerName ?? '',
        dateRange: `${startDate} 〜 ${endDate}`,
        searchTermData: this.formatSearchTermMetrics(searchTerms),
        existingNegativeKeywords: this.formatNegativeKeywords(negativeKeywords),
      });

      const modelConfig = MODEL_CONFIGS.google_ads_negative_keywords_suggestion;
      if (!modelConfig) {
        return fail(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED);
      }

      const rawOutput = await llmChat(
        modelConfig.provider,
        modelConfig.actualModel,
        [{ role: 'user', content: filledPrompt }],
        {
          maxTokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        }
      );

      const { markdown, suggestions } = extractStructuredOutput(rawOutput);
      console.info('[GoogleAdsNegativeKeywordsSuggestionService] Structured suggestions:', {
        userId,
        count: suggestions.length,
        sample: suggestions.slice(0, 3),
      });

      const htmlContent = sanitizeEmailHtml(await marked.parse(markdown || rawOutput));
      const subjectAccountPart = customerName ? ` / ${customerName}` : '';
      const devPrefix = useMockGoogleAds ? '[DEV] ' : '';
      const subject = `${devPrefix}【GrowMate】Google Ads 除外キーワード提案レポート（${endDate}${subjectAccountPart}）`;
      const emailResult = await this.emailService.sendGoogleAdsNegativeKeywords(
        userEmail,
        subject,
        htmlContent
      );

      if (!emailResult.success) {
        return fail(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_EMAIL_SEND_FAILED);
      }

      if (!force) {
        await this.markSuccess(userId, todayJst);
      }

      return {
        success: true,
        message: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_EMAIL_SENT,
      };
    } catch (error) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Unexpected error:', error);
      if (!force) {
        await this.markFailure(
          userId,
          error instanceof Error ? error.message : ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED
        );
      }
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED,
      };
    }
  }

  async runAllDueSuggestions(): Promise<GoogleAdsNegativeKeywordsSuggestionBatchResult> {
    const now = new Date();
    const todayJst = formatJstDateISO(now);
    const sendHourJst = getJstHour(now);
    const dueResult = await this.supabaseService.listDueGoogleAdsNegativeKeywordsSettings(
      sendHourJst,
      todayJst
    );

    if (!dueResult.success) {
      throw new Error(dueResult.error.userMessage);
    }

    const settled: PromiseSettledResult<GoogleAdsNegativeKeywordsSuggestionResult>[] = [];
    for (let index = 0; index < dueResult.data.length; index += CRON_CONCURRENCY) {
      const chunk = dueResult.data.slice(index, index + CRON_CONCURRENCY);
      const chunkSettled = await Promise.allSettled(
        chunk.map(setting => this.sendNegativeKeywordsSuggestionForUser(setting.userId))
      );
      settled.push(...chunkSettled);
    }

    return settled.reduce<GoogleAdsNegativeKeywordsSuggestionBatchResult>(
      (summary, result) => {
        summary.total += 1;
        if (result.status === 'rejected') {
          summary.failed += 1;
          return summary;
        }
        if (result.value.skipped) {
          summary.skipped += 1;
          return summary;
        }
        if (result.value.success) {
          summary.succeeded += 1;
          return summary;
        }
        summary.failed += 1;
        return summary;
      },
      { total: 0, succeeded: 0, failed: 0, skipped: 0 }
    );
  }

  private async ensureSettings(userId: string) {
    const existing = await this.supabaseService.getGoogleAdsNegativeKeywordsSettings(userId);
    if (!existing.success) {
      return null;
    }
    if (existing.data) {
      return existing.data;
    }

    const upsertResult = await this.supabaseService.upsertGoogleAdsNegativeKeywordsSettings({
      userId,
      enabled: false,
      sendHourJst: DEFAULT_SEND_HOUR_JST,
    });
    if (!upsertResult.success) {
      return null;
    }

    const created = await this.supabaseService.getGoogleAdsNegativeKeywordsSettings(userId);
    return created.success ? created.data : null;
  }

  private async markSuccess(userId: string, todayJst: string): Promise<void> {
    const result = await this.supabaseService.updateGoogleAdsNegativeKeywordsSettings(userId, {
      last_sent_on: todayJst,
      last_send_error: null,
    });
    if (!result.success) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Failed to mark success:', result.error);
    }
  }

  private async markFailure(userId: string, errorMessage: string): Promise<void> {
    const result = await this.supabaseService.updateGoogleAdsNegativeKeywordsSettings(userId, {
      last_send_error: errorMessage,
    });
    if (!result.success) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Failed to mark failure:', result.error);
    }
  }

  private async ensureAccessToken(
    userId: string,
    credential: NonNullable<Awaited<ReturnType<SupabaseService['getGoogleAdsCredential']>>>
  ): Promise<string | null> {
    const expiresAt = credential.accessTokenExpiresAt
      ? new Date(credential.accessTokenExpiresAt)
      : null;
    const isExpiringSoon =
      !credential.accessToken ||
      !expiresAt ||
      expiresAt.getTime() < Date.now() + 5 * 60 * 1000;

    if (!isExpiringSoon) {
      return credential.accessToken;
    }

    try {
      const refreshed = await this.googleAdsService.refreshAccessToken(credential.refreshToken);
      const saveResult = await this.supabaseService.saveGoogleAdsCredential(userId, {
        accessToken: refreshed.accessToken,
        refreshToken: credential.refreshToken,
        expiresIn: refreshed.expiresIn,
        scope: refreshed.scope || credential.scope || [],
        googleAccountEmail: credential.googleAccountEmail,
        managerCustomerId: credential.managerCustomerId,
      });

      if (!saveResult.success) {
        return null;
      }

      return refreshed.accessToken;
    } catch (error) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Failed to refresh Google Ads token:', error);
      return null;
    }
  }

  private async resolveCustomerName(input: {
    accessToken: string;
    customerId: string;
    managerCustomerId: string | null;
  }): Promise<string | null> {
    try {
      const customerInfo = await this.googleAdsService.getCustomerInfo(
        input.customerId,
        input.accessToken,
        input.managerCustomerId ?? undefined
      );
      return customerInfo?.name ?? null;
    } catch (error) {
      console.warn('[GoogleAdsNegativeKeywordsSuggestionService] Failed to fetch customer name:', error);
      return null;
    }
  }

  private formatSearchTermMetrics(metrics: GoogleAdsSearchTermMetric[]): string {
    const header = '検索語句 | キャンペーン名 | 広告グループ名 | IMP | Click | Cost(円) | CV';
    const separator = '--------|------------|------------|-----|-------|---------|-----';
    if (metrics.length === 0) {
      return `${header}\n${separator}\n（データなし） | - | - | 0 | 0 | 0 | 0`;
    }

    const rows = [...metrics]
      .sort((a, b) => b.impressions - a.impressions)
      .map(metric =>
        [
          metric.searchTerm,
          metric.campaignName || '-',
          metric.adGroupName || '-',
          this.formatInteger(metric.impressions),
          this.formatInteger(metric.clicks),
          this.formatInteger(metric.cost),
          this.formatNumber(metric.conversions),
        ].join(' | ')
      );

    return [header, separator, ...rows].join('\n');
  }

  private formatNegativeKeywords(keywords: GoogleAdsNegativeKeyword[]): string {
    const header =
      '除外キーワード | マッチタイプ | レベル | キャンペーン | キャンペーン状態 | 広告グループ | 広告グループ状態';
    const separator =
      '------------|------------|-------|------------|----------------|------------|----------------';

    if (keywords.length === 0) {
      return `${header}\n${separator}\n（除外キーワードなし） | - | - | - | - | - | -`;
    }

    const rows = keywords.map(keyword =>
      [
        keyword.keywordText,
        keyword.matchType,
        keyword.level,
        keyword.campaignName || '-',
        keyword.campaignStatus || '-',
        keyword.adGroupName || '-',
        keyword.adGroupStatus || '-',
      ].join(' | ')
    );

    return [header, separator, ...rows].join('\n');
  }

  private formatInteger(value: number): string {
    return Math.round(value).toLocaleString('ja-JP');
  }

  private formatNumber(value: number): string {
    if (Number.isInteger(value)) {
      return value.toString();
    }

    return value.toFixed(2);
  }
}

export const googleAdsNegativeKeywordsSuggestionService =
  new GoogleAdsNegativeKeywordsSuggestionService();

const DEV_SAMPLE_SEARCH_TERMS: GoogleAdsSearchTermMetric[] = [
  { searchTerm: '家具 買取 アルバイト', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 1280, clicks: 32, cost: 12400, conversions: 0 },
  { searchTerm: '古銭 価値 調べ方', campaignId: '2002', campaignName: '骨董品買取_一般', adGroupId: '3002', adGroupName: '古銭買取', impressions: 940, clicks: 0, cost: 0, conversions: 0 },
  { searchTerm: '他社ブランド 買取 評判', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3003', adGroupName: 'ブランド家具', impressions: 410, clicks: 8, cost: 3200, conversions: 0 },
  { searchTerm: '出張 買取 家具', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 860, clicks: 74, cost: 26640, conversions: 5 },
  { searchTerm: 'アンティーク 時計 買取', campaignId: '2002', campaignName: '骨董品買取_一般', adGroupId: '3004', adGroupName: '時計買取', impressions: 620, clicks: 49, cost: 19600, conversions: 3 },
];

const DEV_SAMPLE_NEGATIVE_KEYWORDS: GoogleAdsNegativeKeyword[] = [
  {
    keywordText: 'アルバイト',
    matchType: 'BROAD',
    level: 'campaign',
    campaignName: '家具買取_一般',
    campaignStatus: 'ENABLED',
  },
  {
    keywordText: '自分で',
    matchType: 'PHRASE',
    level: 'campaign',
    campaignName: '骨董品買取_一般',
    campaignStatus: 'ENABLED',
  },
  {
    keywordText: '評判',
    matchType: 'PHRASE',
    level: 'ad_group',
    campaignName: '家具買取_一般',
    campaignStatus: 'ENABLED',
    adGroupName: 'ブランド家具',
    adGroupStatus: 'ENABLED',
  },
];
