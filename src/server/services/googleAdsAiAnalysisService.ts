import { marked } from 'marked';
import { buildLocalDateRange, formatJstDateISO } from '@/lib/date-utils';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { llmChat } from '@/server/services/llmService';
import { briefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { EmailService, emailService as defaultEmailService } from '@/server/services/emailService';
import type { BriefInput, Service } from '@/server/schemas/brief.schema';
import type { GoogleAdsAiAnalysisResult } from '@/types/google-ads-evaluation';
import type {
  GoogleAdsKeywordMetric,
  GoogleAdsNegativeKeyword,
  KeywordHistoricalMetric,
} from '@/types/googleAds.types';

const DEFAULT_DATE_RANGE_DAYS = 30;

function buildAnalysisPrompt(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
}

function formatJstTime(date: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
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

class GoogleAdsAiAnalysisService {
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

  async analyzeAndSend(
    userId: string,
    options?: {
      dateRangeDays?: number;
      serviceId?: string;
    }
  ): Promise<GoogleAdsAiAnalysisResult> {
    const executedAt = new Date();
    const todayJst = formatJstDateISO(executedAt);

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

      const settings = await this.ensureEvaluationSettings(userId);
      if (!settings) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SETTINGS_NOT_FOUND,
        };
      }

      const dateRangeDays = options?.dateRangeDays ?? settings.dateRangeDays ?? DEFAULT_DATE_RANGE_DAYS;
      const { startDate, endDate } = buildLocalDateRange(dateRangeDays);

      // --- DEV ONLY: サンプルデータを使用してローカル確認 ---
      if (process.env.NODE_ENV === 'development') {
        const brief = await briefService.getVariablesByUserId(userId);
        const targetService = this.resolveTargetService(brief, options?.serviceId);
        if (!targetService) {
          return {
            success: false,
            error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SERVICE_REQUIRED,
          };
        }
        const promptTemplate = await PromptService.getTemplateByName('google_ads_ai_evaluation');
        if (!promptTemplate) {
          return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_PROMPT_NOT_FOUND };
        }
        const filledPrompt = buildAnalysisPrompt(promptTemplate.content, {
          persona: brief?.persona?.trim() || '（ペルソナ未設定）',
          serviceName: targetService.name,
          strength: this.formatStrength(targetService),
          keywordData: this.formatKeywordMetrics(DEV_SAMPLE_KEYWORDS),
          negativeKeywords: this.formatNegativeKeywords(DEV_SAMPLE_NEGATIVE_KEYWORDS),
          dateRange: `${startDate} 〜 ${endDate}`,
          customerName: 'サンプル株式会社（開発用）',
        });
        const modelConfig = MODEL_CONFIGS.google_ads_ai_evaluation;
        if (!modelConfig) {
          return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED };
        }
        const analysisMarkdown = await llmChat(
          modelConfig.provider,
          modelConfig.actualModel,
          [{ role: 'user', content: filledPrompt }],
          { maxTokens: modelConfig.maxTokens, temperature: modelConfig.temperature }
        );
        const htmlContent = sanitizeEmailHtml(await marked.parse(analysisMarkdown));
        const subject = `[DEV] Google Ads コンテンツ戦略提案レポート（${formatJstTime(executedAt)}実行 / サンプル株式会社）`;
        const emailResult = await this.emailService.sendGoogleAdsAnalysis(userEmail, subject, htmlContent);
        if (!emailResult.success) {
          return { success: false, error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_EMAIL_SEND_FAILED };
        }
        const markSuccessResult = await this.supabaseService.updateGoogleAdsEvaluationSettings(userId, {
          last_evaluated_on: todayJst,
        });
        if (!markSuccessResult.success) {
          console.error('[GoogleAdsAiAnalysisService] [DEV] Failed to mark evaluation success:', markSuccessResult.error);
        }
        return { success: true, message: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_EMAIL_SENT };
      }
      // --- DEV ONLY ここまで ---

      const accessToken = await this.ensureAccessToken(userId, credential);
      if (!accessToken) {
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
        briefService.getVariablesByUserId(userId),
      ]);

      if (!keywordResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to fetch keyword metrics:', keywordResult.error);
        return {
          success: false,
          error: keywordResult.error ?? ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED,
        };
      }

      // 取得したキーワードの検索ボリュームを Keyword Plan API で補完する
      const keywordTexts = [
        ...new Set((keywordResult.data ?? []).map(k => k.keywordText)),
      ];
      const historicalMetricsResult = await this.googleAdsService.getKeywordHistoricalMetrics({
        accessToken,
        customerId: credential.customerId,
        keywords: keywordTexts,
        ...(credential.managerCustomerId && {
          loginCustomerId: credential.managerCustomerId,
        }),
      });

      if (historicalMetricsResult.success && historicalMetricsResult.data) {
        this.mergeSearchVolume(keywordResult.data ?? [], historicalMetricsResult.data);
      } else {
        console.warn(
          '[GoogleAdsAiAnalysisService] Search volume fetch failed (non-fatal):',
          historicalMetricsResult.error
        );
      }

      if (!negativeKeywordResult.success) {
        console.error(
          '[GoogleAdsAiAnalysisService] Failed to fetch negative keywords:',
          negativeKeywordResult.error
        );
        return {
          success: false,
          error:
            negativeKeywordResult.error ??
            ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_FETCH_FAILED,
        };
      }

      const promptTemplate = await PromptService.getTemplateByName('google_ads_ai_evaluation');
      if (!promptTemplate) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_PROMPT_NOT_FOUND,
        };
      }

      const customerName = await this.resolveCustomerName({
        accessToken,
        customerId: credential.customerId,
        managerCustomerId: credential.managerCustomerId,
      });
      const targetService = this.resolveTargetService(brief, options?.serviceId);
      if (!targetService) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SERVICE_REQUIRED,
        };
      }
      const filledPrompt = buildAnalysisPrompt(promptTemplate.content, {
        persona: brief?.persona?.trim() || '（ペルソナ未設定）',
        serviceName: targetService.name,
        strength: this.formatStrength(targetService),
        keywordData: this.formatKeywordMetrics(keywordResult.data ?? []),
        negativeKeywords: this.formatNegativeKeywords(negativeKeywordResult.data ?? []),
        dateRange: `${startDate} 〜 ${endDate}`,
        customerName: customerName ?? '',
      });

      const modelConfig = MODEL_CONFIGS.google_ads_ai_evaluation;
      if (!modelConfig) {
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

      const htmlContent = sanitizeEmailHtml(await marked.parse(analysisMarkdown));
      const subjectAccountPart = customerName ? ` / ${customerName}` : '';
      const subject = `【GrowMate】Google Ads コンテンツ戦略提案レポート（${formatJstTime(executedAt)}実行${subjectAccountPart}）`;
      const emailResult = await this.emailService.sendGoogleAdsAnalysis(
        userEmail,
        subject,
        htmlContent
      );

      if (!emailResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to send analysis email:', emailResult.error);
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_EMAIL_SEND_FAILED,
        };
      }

      const markSuccessResult = await this.supabaseService.updateGoogleAdsEvaluationSettings(userId, {
        last_evaluated_on: todayJst,
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
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_RUN_FAILED,
      };
    }
  }

  private async ensureEvaluationSettings(userId: string) {
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
      dateRangeDays: DEFAULT_DATE_RANGE_DAYS,
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
        return null;
      }

      return refreshed.accessToken;
    } catch (error) {
      console.error('[GoogleAdsAiAnalysisService] Failed to refresh Google Ads token:', error);
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
      console.warn('[GoogleAdsAiAnalysisService] Failed to fetch customer name:', {
        customerId: input.customerId,
        error,
      });
      return null;
    }
  }

  private resolveTargetService(brief: BriefInput | null, serviceId?: string): Service | null {
    if (!brief?.services?.length) {
      return null;
    }

    if (serviceId) {
      const matchedService = brief.services.find(service => service.id === serviceId);
      if (matchedService) {
        return matchedService;
      }

      console.warn('[GoogleAdsAiAnalysisService] Requested serviceId was not found in brief:', {
        serviceId,
      });
    }

    return brief.services[0] ?? null;
  }

  private formatStrength(service: Service | null): string {
    return service?.strength?.trim() || '（事業の強み未設定）';
  }

  private mergeSearchVolume(
    metrics: GoogleAdsKeywordMetric[],
    historicalData: KeywordHistoricalMetric[]
  ): void {
    const volumeMap = new Map(
      historicalData.map(h => [h.keywordText, h.avgMonthlySearches])
    );
    for (const metric of metrics) {
      const volume = volumeMap.get(metric.keywordText);
      if (volume !== undefined) {
        metric.searchVolume = volume;
      }
    }
  }

  private formatKeywordMetrics(metrics: GoogleAdsKeywordMetric[]): string {
    const header =
      'キーワード | マッチタイプ | ステータス | キャンペーン | 広告グループ | 月間検索数 | IMP | Click | CTR | CPC(円) | CV | CVR | CPA(円) | 費用(円) | 品質スコア | 検索IMP Share';
    const separator =
      '----------|------------|----------|------------|------------|----------|-----|-------|-----|---------|-----|-----|---------|---------|----------|-------------';

    if (metrics.length === 0) {
      return `${header}\n${separator}\nデータなし | - | - | - | - | - | 0 | 0 | 0.00% | 0 | 0 | 0.00% | - | 0 | - | -`;
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
          metric.searchVolume === null ? '-' : this.formatInteger(metric.searchVolume),
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

  private formatPercent(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }
}

export const googleAdsAiAnalysisService = new GoogleAdsAiAnalysisService();

// ============================================================
// DEV ONLY: ローカル確認用サンプルデータ（エアコンクリーニング）
// ============================================================
const DEV_SAMPLE_KEYWORDS: GoogleAdsKeywordMetric[] = [
  { keywordId: '1001', keywordText: 'エアコンクリーニング', matchType: 'BROAD', campaignName: 'エアコン洗浄_一般', adGroupName: 'クリーニング全般', status: 'ENABLED', impressions: 12400, clicks: 620, ctr: 0.05, cpc: 320, cost: 198400, qualityScore: 7, conversions: 18, costPerConversion: 11022, searchImpressionShare: 0.42, conversionRate: 0.029, searchVolume: 33100 },
  { keywordId: '1002', keywordText: 'エアコンクリーニング 料金', matchType: 'EXACT', campaignName: 'エアコン洗浄_一般', adGroupName: '料金・費用', status: 'ENABLED', impressions: 5800, clicks: 464, ctr: 0.08, cpc: 280, cost: 129920, qualityScore: 9, conversions: 22, costPerConversion: 5905, searchImpressionShare: 0.71, conversionRate: 0.047, searchVolume: 8100 },
  { keywordId: '1003', keywordText: 'エアコン 掃除 業者', matchType: 'PHRASE', campaignName: 'エアコン洗浄_一般', adGroupName: 'クリーニング全般', status: 'ENABLED', impressions: 8200, clicks: 410, ctr: 0.05, cpc: 350, cost: 143500, qualityScore: 6, conversions: 12, costPerConversion: 11958, searchImpressionShare: 0.38, conversionRate: 0.029, searchVolume: 12100 },
  { keywordId: '1004', keywordText: 'エアコン 分解洗浄', matchType: 'PHRASE', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'ENABLED', impressions: 3100, clicks: 217, ctr: 0.07, cpc: 420, cost: 91140, qualityScore: 8, conversions: 9, costPerConversion: 10127, searchImpressionShare: 0.55, conversionRate: 0.041, searchVolume: 4400 },
  { keywordId: '1005', keywordText: 'エアコン内部クリーニング', matchType: 'EXACT', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'ENABLED', impressions: 2400, clicks: 192, ctr: 0.08, cpc: 390, cost: 74880, qualityScore: 9, conversions: 11, costPerConversion: 6807, searchImpressionShare: 0.68, conversionRate: 0.057, searchVolume: 2900 },
  { keywordId: '1006', keywordText: 'エアコンクリーニング 業者 おすすめ', matchType: 'BROAD', campaignName: 'エアコン洗浄_一般', adGroupName: '業者選び', status: 'ENABLED', impressions: 6500, clicks: 260, ctr: 0.04, cpc: 310, cost: 80600, qualityScore: 5, conversions: 7, costPerConversion: 11514, searchImpressionShare: 0.29, conversionRate: 0.027, searchVolume: 5400 },
  { keywordId: '1007', keywordText: '壁掛けエアコン クリーニング', matchType: 'PHRASE', campaignName: 'エアコン洗浄_一般', adGroupName: '機種別', status: 'ENABLED', impressions: 1800, clicks: 126, ctr: 0.07, cpc: 360, cost: 45360, qualityScore: 7, conversions: 5, costPerConversion: 9072, searchImpressionShare: 0.51, conversionRate: 0.04, searchVolume: 1600 },
  { keywordId: '1008', keywordText: 'エアコン 丸洗い', matchType: 'BROAD', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'PAUSED', impressions: 900, clicks: 27, ctr: 0.03, cpc: 400, cost: 10800, qualityScore: 4, conversions: 1, costPerConversion: 10800, searchImpressionShare: 0.18, conversionRate: 0.037, searchVolume: null },
  { keywordId: '1009', keywordText: 'エアコンクリーニング 一台', matchType: 'EXACT', campaignName: 'エアコン洗浄_一般', adGroupName: '料金・費用', status: 'ENABLED', impressions: 4200, clicks: 378, ctr: 0.09, cpc: 295, cost: 111510, qualityScore: 8, conversions: 19, costPerConversion: 5869, searchImpressionShare: 0.74, conversionRate: 0.05, searchVolume: 3600 },
  { keywordId: '1010', keywordText: 'エアコン 洗浄 プロ', matchType: 'PHRASE', campaignName: 'エアコン洗浄_プレミアム', adGroupName: 'プロ・専門業者', status: 'ENABLED', impressions: 2700, clicks: 162, ctr: 0.06, cpc: 375, cost: 60750, qualityScore: 6, conversions: 6, costPerConversion: 10125, searchImpressionShare: 0.44, conversionRate: 0.037, searchVolume: 1300 },
];

const DEV_SAMPLE_NEGATIVE_KEYWORDS: GoogleAdsNegativeKeyword[] = [
  { keywordText: 'DIY', matchType: 'BROAD', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
  { keywordText: '自分で 掃除', matchType: 'PHRASE', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
  { keywordText: 'フィルター 掃除', matchType: 'PHRASE', level: 'ad_group', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED', adGroupName: 'クリーニング全般', adGroupStatus: 'ENABLED' },
  { keywordText: '中古 エアコン', matchType: 'BROAD', level: 'campaign', campaignName: 'エアコン洗浄_プレミアム', campaignStatus: 'ENABLED' },
  { keywordText: '無料', matchType: 'EXACT', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
];
