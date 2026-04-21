import { marked } from 'marked';
import { buildLocalDateRange, formatLocalDateYMD } from '@/lib/date-utils';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { llmChat } from '@/server/services/llmService';
import { BriefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { EmailService } from '@/server/services/emailService';
import type { GoogleAdsAiAnalysisResult } from '@/types/google-ads-evaluation';
import type {
  GoogleAdsKeywordMetric,
  GoogleAdsNegativeKeyword,
} from '@/types/googleAds.types';

const DEFAULT_DATE_RANGE_DAYS = 30;

export class GoogleAdsAiAnalysisService {
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
    this.emailService = emailService ?? new EmailService();
  }

  async analyzeAndSend(
    userId: string,
    options?: {
      dateRangeDays?: number;
      force?: boolean;
    }
  ): Promise<GoogleAdsAiAnalysisResult> {
    const todayJst = formatLocalDateYMD(new Date());

    try {
      const userResult = await this.supabaseService.getUserById(userId);
      if (!userResult.success || !userResult.data) {
        return { success: false, error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND };
      }

      const userEmail = userResult.data.email;
      if (!userEmail) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_AI_EVALUATION,
        };
      }

      const credential = await this.supabaseService.getGoogleAdsCredential(userId);
      if (!credential) {
        return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.NOT_CONNECTED };
      }
      if (!credential.customerId) {
        return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED };
      }

      let settings = await this.ensureEvaluationSettings(
        userId,
        credential.customerId,
        null
      );
      if (!settings) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_NOT_FOUND,
        };
      }

      if (!options?.force && settings.lastEvaluatedOn === todayJst) {
        return {
          success: true,
          skipped: true,
          message: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_ALREADY_COMPLETED,
        };
      }

      const dateRangeDays = options?.dateRangeDays ?? settings.dateRangeDays ?? DEFAULT_DATE_RANGE_DAYS;
      const { startDate, endDate } = buildLocalDateRange(dateRangeDays);

      const accessToken = await this.ensureAccessToken(userId, credential);
      if (!accessToken) {
        await this.markFailure(userId);
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED,
        };
      }

      const [keywordResult, negativeKeywordResult, brief] = await Promise.all([
        this.googleAdsService.getKeywordMetrics({
          accessToken,
          customerId: credential.customerId,
          startDate,
          endDate,
          includeAllStatuses: true,
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
        BriefService.getVariablesByUserId(userId),
      ]);

      if (!keywordResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to fetch keyword metrics:', keywordResult.error);
        await this.markFailure(userId);
        return {
          success: false,
          error: keywordResult.error ?? ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED,
        };
      }

      if (!negativeKeywordResult.success) {
        console.error(
          '[GoogleAdsAiAnalysisService] Failed to fetch negative keywords:',
          negativeKeywordResult.error
        );
        await this.markFailure(userId);
        return {
          success: false,
          error:
            negativeKeywordResult.error ?? ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED,
        };
      }

      const promptTemplate = await PromptService.getTemplateByName('google_ads_ai_evaluation');
      if (!promptTemplate) {
        await this.markFailure(userId);
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_PROMPT_NOT_FOUND,
        };
      }

      settings = await this.ensureEvaluationSettings(
        userId,
        credential.customerId,
        settings.customerName
      );

      const customerName = settings?.customerName ?? credential.customerId;
      const filledPrompt = PromptService.replaceVariables(promptTemplate.content, {
        persona: brief?.persona?.trim() || '（ペルソナ未設定）',
        strengths: this.formatStrengths(brief),
        keywordData: this.formatKeywordMetrics(keywordResult.data ?? []),
        negativeKeywords: this.formatNegativeKeywords(negativeKeywordResult.data ?? []),
        dateRange: `${startDate} 〜 ${endDate}`,
        customerName,
      });

      const modelConfig = MODEL_CONFIGS.google_ads_ai_evaluation;
      if (!modelConfig) {
        await this.markFailure(userId);
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED,
        };
      }
      const analysisMarkdown = await llmChat(
        modelConfig.provider,
        modelConfig.actualModel,
        [{ role: 'user', content: filledPrompt }],
        {
          maxTokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        }
      );

      const htmlContent = await marked.parse(analysisMarkdown);
      const subject = `【GrowMate】Google Ads AI分析レポート (${customerName})`;
      const emailResult = await this.emailService.sendGoogleAdsAnalysis(
        userEmail,
        subject,
        htmlContent
      );

      if (!emailResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to send analysis email:', emailResult.error);
        await this.markFailure(userId);
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED,
        };
      }

      const markSuccessResult = await this.supabaseService.updateGoogleAdsEvaluationSettings(userId, {
        last_evaluated_on: todayJst,
        consecutive_error_count: 0,
      });
      if (!markSuccessResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to mark evaluation success:', markSuccessResult.error);
      }

      return {
        success: true,
        message: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_EMAIL_SENT,
      };
    } catch (error) {
      console.error('[GoogleAdsAiAnalysisService] Unexpected analysis error:', error);
      await this.markFailure(userId);
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED,
      };
    }
  }

  private async ensureEvaluationSettings(
    userId: string,
    customerId: string,
    customerName: string | null
  ) {
    const existing = await this.supabaseService.getGoogleAdsEvaluationSettings(userId);
    if (!existing.success) {
      console.error('[GoogleAdsAiAnalysisService] Failed to load evaluation settings:', existing.error);
      return null;
    }

    if (existing.data) {
      return existing.data;
    }

    const upsertResult = await this.supabaseService.upsertGoogleAdsEvaluationSettings({
      userId,
      customerId,
      customerName,
      dateRangeDays: DEFAULT_DATE_RANGE_DAYS,
      cronEnabled: false,
    });

    if (!upsertResult.success) {
      console.error('[GoogleAdsAiAnalysisService] Failed to create evaluation settings:', upsertResult.error);
      return null;
    }

    const created = await this.supabaseService.getGoogleAdsEvaluationSettings(userId);
    return created.success ? created.data : null;
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
        console.error('[GoogleAdsAiAnalysisService] Failed to persist refreshed token:', saveResult.error);
      }

      return refreshed.accessToken;
    } catch (error) {
      console.error('[GoogleAdsAiAnalysisService] Failed to refresh Google Ads token:', error);
      return null;
    }
  }

  private async markFailure(userId: string): Promise<void> {
    const settings = await this.supabaseService.getGoogleAdsEvaluationSettings(userId);
    if (!settings.success || !settings.data) {
      return;
    }

    const updateResult = await this.supabaseService.updateGoogleAdsEvaluationSettings(userId, {
      consecutive_error_count: settings.data.consecutiveErrorCount + 1,
    });
    if (!updateResult.success) {
      console.error('[GoogleAdsAiAnalysisService] Failed to increment consecutive error count:', updateResult.error);
    }
  }

  private formatStrengths(
    brief: Awaited<ReturnType<typeof BriefService.getVariablesByUserId>>
  ): string {
    const lines =
      brief?.services
        ?.filter(service => Boolean(service.strength?.trim()))
        .map(service => `${service.name}: ${service.strength?.trim()}`)
        ?? [];

    return lines.length > 0 ? lines.join('\n') : '（事業の強み未設定）';
  }

  private formatKeywordMetrics(metrics: GoogleAdsKeywordMetric[]): string {
    const header =
      'キーワード | マッチタイプ | ステータス | キャンペーン | 広告グループ | IMP | Click | CTR | CPC(円) | CV | CVR | CPA(円) | 費用(円) | 品質スコア | 検索IMP Share';
    const separator =
      '----------|------------|----------|------------|------------|-----|-------|-----|---------|-----|-----|---------|---------|----------|-------------';

    if (metrics.length === 0) {
      return `${header}\n${separator}\nデータなし | - | - | - | - | 0 | 0 | 0.00% | 0 | 0 | 0.00% | - | 0 | - | -`;
    }

    const rows = [...metrics]
      .sort((a, b) => b.impressions - a.impressions)
      .map(metric =>
        [
          metric.keywordText,
          metric.matchType,
          metric.status,
          metric.campaignName || '-',
          metric.adGroupName || '-',
          this.formatInteger(metric.impressions),
          this.formatInteger(metric.clicks),
          this.formatPercent(metric.ctr),
          this.formatInteger(metric.cpc),
          this.formatNumber(metric.conversions),
          this.formatPercent(metric.conversionRate ?? 0),
          metric.costPerConversion === null ? '-' : this.formatInteger(metric.costPerConversion),
          this.formatInteger(metric.cost),
          metric.qualityScore ?? '-',
          metric.searchImpressionShare === null ? '-' : this.formatPercent(metric.searchImpressionShare),
        ].join(' | ')
      );

    return [header, separator, ...rows].join('\n');
  }

  private formatNegativeKeywords(keywords: GoogleAdsNegativeKeyword[]): string {
    const header = '除外キーワード | マッチタイプ | レベル | キャンペーン | 広告グループ';
    const separator = '------------|------------|-------|------------|------------';

    if (keywords.length === 0) {
      return `${header}\n${separator}\n（除外キーワードなし） | - | - | - | -`;
    }

    const rows = keywords.map(keyword =>
      [
        keyword.keywordText,
        keyword.matchType,
        keyword.level,
        keyword.campaignName || '-',
        keyword.adGroupName || '-',
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

  private formatPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }
}

export const googleAdsAiAnalysisService = new GoogleAdsAiAnalysisService();
