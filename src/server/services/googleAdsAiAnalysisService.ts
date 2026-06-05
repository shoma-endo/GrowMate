import { marked } from 'marked';
import { buildLocalDateRange, formatJstDateISO } from '@/lib/date-utils';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { llmChat } from '@/server/services/llmService';
import { briefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { dedupeNegativeKeywords, GoogleAdsService } from '@/server/services/googleAdsService';
import { EmailService, emailService as defaultEmailService } from '@/server/services/emailService';
import type { BriefInput, Service } from '@/server/schemas/brief.schema';
import { normalizeQuery } from '@/lib/normalize-query';
import type {
  ContentInventoryItem,
  GoogleAdsAiAnalysisResult,
  RankingSnapshotItem,
  TopProposalKeyword,
} from '@/types/google-ads-evaluation';
import type {
  GoogleAdsKeywordMetric,
  GoogleAdsNegativeKeyword,
  GoogleAdsSearchTermMetric,
} from '@/types/googleAds.types';

const DEFAULT_DATE_RANGE_DAYS = 30;

// §17 Increment2: AI 出力末尾の ```json ... ``` ブロックを抽出する正規表現
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)\s*```/i;

function buildAnalysisPrompt(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
}

/**
 * §17 Increment2: AI 出力末尾の JSON ブロックから TOP5 提案 KW を抽出する。
 * パース失敗・形式不一致は非致命とし null を返す（順位表なしでメール送信は継続する）。
 */
function extractTopProposals(markdown: string): TopProposalKeyword[] | null {
  const match = markdown.match(JSON_BLOCK_REGEX);
  if (!match || !match[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const proposals: TopProposalKeyword[] = parsed.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }
      const record = item as Record<string, unknown>;
      const mainKw = typeof record.main_kw === 'string' ? record.main_kw.trim() : '';
      if (!mainKw) {
        return [];
      }
      const rank = typeof record.rank === 'number' ? record.rank : 0;
      // kw は改行・読点区切りのサブKW群（設計書 16.3）。分割して正規化対象にする。
      const kwRaw = typeof record.kw === 'string' ? record.kw : '';
      const subKws = kwRaw
        .split(/[\n,、]/)
        .map(value => value.trim())
        .filter(value => value.length > 0);
      return [{ rank, mainKw, subKws }];
    });

    return proposals.length > 0 ? proposals : null;
  } catch (error) {
    console.warn('[GoogleAdsAiAnalysisService] Failed to parse TOP5 JSON block (non-fatal):', error);
    return null;
  }
}

/**
 * §17 Increment2: メール本文から JSON ブロックを除去する（本文に JSON を残さない）。
 */
function stripJsonBlock(markdown: string): string {
  return markdown.replace(JSON_BLOCK_REGEX, '').replace(/\n{3,}/g, '\n\n').trim();
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
  // §17.4: GSC順位スナップショットの取得上限（DB参照のため GSC API クォータは消費しない）
  private static readonly RANKING_SNAPSHOT_LIMIT = 500;

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
          searchTermData: this.formatSearchTermMetrics(DEV_SAMPLE_SEARCH_TERMS),
          existingContent: this.formatContentInventory(DEV_SAMPLE_CONTENT_INVENTORY),
          rankingData: this.formatRankingSnapshot(DEV_SAMPLE_RANKING_SNAPSHOT),
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
        const emailMarkdown = this.composeEmailMarkdown(analysisMarkdown, DEV_SAMPLE_RANKING_SNAPSHOT);
        const htmlContent = sanitizeEmailHtml(await marked.parse(emailMarkdown));
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

      const [
        keywordResult,
        negativeKeywordResult,
        searchTermResult,
        brief,
        contentInventoryResult,
        rankingSnapshotResult,
      ] = await Promise.all([
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
        this.googleAdsService.getSearchTermMetrics({
          accessToken,
          customerId: credential.customerId,
          startDate,
          endDate,
          ...(credential.managerCustomerId && {
            loginCustomerId: credential.managerCustomerId,
          }),
        }),
        briefService.getVariablesByUserId(userId),
        this.supabaseService.getContentInventoryByUserId(userId),
        this.supabaseService.getRankingSnapshotByUserId(
          userId,
          GoogleAdsAiAnalysisService.RANKING_SNAPSHOT_LIMIT
        ),
      ]);

      if (!keywordResult.success) {
        console.error('[GoogleAdsAiAnalysisService] Failed to fetch keyword metrics:', keywordResult.error);
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
        return {
          success: false,
          error:
            negativeKeywordResult.error ??
            ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_FETCH_FAILED,
        };
      }

      if (!searchTermResult.success) {
        console.warn(
          '[GoogleAdsAiAnalysisService] Failed to fetch search term metrics (non-fatal):',
          searchTermResult.error
        );
      }

      // §17: 既存コンテンツ在庫・GSC順位は取得失敗を非致命とし、空コンテキストで分析を続行する
      if (!contentInventoryResult.success) {
        console.warn(
          '[GoogleAdsAiAnalysisService] Failed to fetch content inventory (non-fatal):',
          contentInventoryResult.error
        );
      }
      if (!rankingSnapshotResult.success) {
        console.warn(
          '[GoogleAdsAiAnalysisService] Failed to fetch ranking snapshot (non-fatal):',
          rankingSnapshotResult.error
        );
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
        searchTermData: this.formatSearchTermMetrics(searchTermResult.data ?? []),
        existingContent: this.formatContentInventory(
          contentInventoryResult.success ? contentInventoryResult.data : []
        ),
        rankingData: this.formatRankingSnapshot(
          rankingSnapshotResult.success ? rankingSnapshotResult.data : []
        ),
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

      const emailMarkdown = this.composeEmailMarkdown(
        analysisMarkdown,
        rankingSnapshotResult.success ? rankingSnapshotResult.data : []
      );
      const htmlContent = sanitizeEmailHtml(await marked.parse(emailMarkdown));
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
    const deduped = dedupeNegativeKeywords(keywords);
    const header =
      '除外キーワード | マッチタイプ | レベル | キャンペーン | キャンペーン状態 | 広告グループ | 広告グループ状態';
    const separator =
      '------------|------------|-------|------------|----------------|------------|----------------';

    if (deduped.length === 0) {
      return `${header}\n${separator}\n（除外キーワードなし） | - | - | - | - | - | -`;
    }

    const rows = deduped.map(keyword =>
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

  private formatSearchTermMetrics(metrics: GoogleAdsSearchTermMetric[]): string {
    const header = '検索語句 | キャンペーン名 | 広告グループ名 | 表示回数 | クリック数 | 費用 | コンバージョン数';
    const separator = '--------|------------|------------|--------|----------|------|----------------';

    if (metrics.length === 0) {
      return `${header}\n${separator}\n（データなし） | - | - | 0 | 0 | 0 | 0`;
    }

    const rows = [...metrics]
      .sort((a, b) => b.impressions - a.impressions)
      .map(m =>
        [
          m.searchTerm,
          m.campaignName || '-',
          m.adGroupName || '-',
          this.formatInteger(m.impressions),
          this.formatInteger(m.clicks),
          this.formatInteger(m.cost),
          this.formatNumber(m.conversions),
        ].join(' | ')
      );

    return [header, separator, ...rows].join('\n');
  }

  private formatContentInventory(items: ContentInventoryItem[]): string {
    // §17.7 指針: LLM 向けは区切り行（---｜---）を省略しトークンを節約する
    const header = 'タイトル | URL | メインKW | サブKW | カテゴリ | 本文抜粋';
    if (items.length === 0) {
      return `${header}\n（既存コンテンツなし）`;
    }

    const rows = items.map(item =>
      [
        item.title || '-',
        item.url || '-',
        item.mainKw || '-',
        item.kw || '-',
        item.categoryNames.length > 0 ? item.categoryNames.join('・') : '-',
        item.excerpt ? item.excerpt.replace(/\s+/g, ' ').trim() : '-',
      ].join(' | ')
    );

    return [header, ...rows].join('\n');
  }

  private formatRankingSnapshot(items: RankingSnapshotItem[]): string {
    const header = 'クエリ | 順位 | IMP | Click | タイトル | URL';
    if (items.length === 0) {
      return `${header}\n（順位データなし）`;
    }

    const rows = items.map(item =>
      [
        item.queryNormalized || '-',
        this.formatNumber(item.position),
        this.formatInteger(item.impressions),
        this.formatInteger(item.clicks),
        item.title || '-',
        item.url || '-',
      ].join(' | ')
    );

    return [header, ...rows].join('\n');
  }

  /**
   * §17.4 Increment2: AI 出力の TOP5 提案 KW を GSC 順位スナップショットに正規化一致で突合し、
   * 検索順位・タイトル・URL を「コード側で機械生成」してメール用 Markdown を返す（捏造防止）。
   * AI は新規/修正の判断文のみを担当し、順位・URL はここで決定的に組み立てる。
   */
  private buildRankingBlocks(
    proposals: TopProposalKeyword[],
    rankingSnapshot: RankingSnapshotItem[]
  ): string {
    const hasSnapshot = rankingSnapshot.length > 0;
    const snapshotByQuery = new Map<string, RankingSnapshotItem>();
    for (const item of rankingSnapshot) {
      const key = normalizeQuery(item.queryNormalized);
      // 同一正規化クエリは上位（position 昇順で取得済み）を優先
      if (!snapshotByQuery.has(key)) {
        snapshotByQuery.set(key, item);
      }
    }

    const renderKw = (label: string, kw: string): string => {
      const matched = snapshotByQuery.get(normalizeQuery(kw));
      if (!matched) {
        // 順位が取れないことは「既存コンテンツなし＝新規候補」を意味しない
        // （GSC未連携・取得失敗・圏外でも既存記事は存在し得る）ため断定しない。
        const note = hasSnapshot
          ? `順位データなし（上位${GoogleAdsAiAnalysisService.RANKING_SNAPSHOT_LIMIT}件に該当なし）`
          : '順位データなし';
        return `${label} ${kw}\n  ${note}`;
      }
      const lines = [
        `${label} ${kw}`,
        `  検索順位：${this.formatNumber(matched.position)}位`,
      ];
      if (matched.title) {
        lines.push(`  タイトル：${matched.title}`);
      }
      if (matched.url) {
        lines.push(`  ${matched.url}`);
      }
      return lines.join('\n');
    };

    const blocks = [...proposals]
      .sort((a, b) => a.rank - b.rank)
      .map(proposal => {
        const parts = [renderKw('▼ メインKW ▼', proposal.mainKw)];
        if (proposal.subKws.length > 0) {
          parts.push('▼ サブKW ▼');
          parts.push(...proposal.subKws.map(kw => renderKw('・', kw)));
        }
        return parts.join('\n');
      });

    const headerLines = ['## 現状成績（検索順位・タイトル・URL）'];
    if (!hasSnapshot) {
      headerLines.push('※ GSC未連携または順位データ取得失敗のため、検索順位は表示できません。');
    }
    return [...headerLines, '', ...blocks].join('\n\n');
  }

  /**
   * §17.4 Increment2: AI 出力（Markdown）から JSON ブロックを取り除き、
   * コード機械生成の順位表ブロックを末尾に結合してメール本文 Markdown を組み立てる。
   * JSON が無い／パース不能な場合は順位表を付けず本文のみを返す（非致命・従来挙動）。
   */
  private composeEmailMarkdown(
    analysisMarkdown: string,
    rankingSnapshot: RankingSnapshotItem[]
  ): string {
    const proposals = extractTopProposals(analysisMarkdown);
    const body = stripJsonBlock(analysisMarkdown);
    if (!proposals) {
      return body;
    }
    const rankingBlocks = this.buildRankingBlocks(proposals, rankingSnapshot);
    return `${body}\n\n${rankingBlocks}`;
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
  { keywordId: '1001', keywordText: 'エアコンクリーニング', matchType: 'BROAD', campaignName: 'エアコン洗浄_一般', adGroupName: 'クリーニング全般', status: 'ENABLED', impressions: 12400, clicks: 620, ctr: 0.05, cpc: 320, cost: 198400, qualityScore: 7, conversions: 18, costPerConversion: 11022, searchImpressionShare: 0.42, conversionRate: 0.029 },
  { keywordId: '1002', keywordText: 'エアコンクリーニング 料金', matchType: 'EXACT', campaignName: 'エアコン洗浄_一般', adGroupName: '料金・費用', status: 'ENABLED', impressions: 5800, clicks: 464, ctr: 0.08, cpc: 280, cost: 129920, qualityScore: 9, conversions: 22, costPerConversion: 5905, searchImpressionShare: 0.71, conversionRate: 0.047 },
  { keywordId: '1003', keywordText: 'エアコン 掃除 業者', matchType: 'PHRASE', campaignName: 'エアコン洗浄_一般', adGroupName: 'クリーニング全般', status: 'ENABLED', impressions: 8200, clicks: 410, ctr: 0.05, cpc: 350, cost: 143500, qualityScore: 6, conversions: 12, costPerConversion: 11958, searchImpressionShare: 0.38, conversionRate: 0.029 },
  { keywordId: '1004', keywordText: 'エアコン 分解洗浄', matchType: 'PHRASE', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'ENABLED', impressions: 3100, clicks: 217, ctr: 0.07, cpc: 420, cost: 91140, qualityScore: 8, conversions: 9, costPerConversion: 10127, searchImpressionShare: 0.55, conversionRate: 0.041 },
  { keywordId: '1005', keywordText: 'エアコン内部クリーニング', matchType: 'EXACT', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'ENABLED', impressions: 2400, clicks: 192, ctr: 0.08, cpc: 390, cost: 74880, qualityScore: 9, conversions: 11, costPerConversion: 6807, searchImpressionShare: 0.68, conversionRate: 0.057 },
  { keywordId: '1006', keywordText: 'エアコンクリーニング 業者 おすすめ', matchType: 'BROAD', campaignName: 'エアコン洗浄_一般', adGroupName: '業者選び', status: 'ENABLED', impressions: 6500, clicks: 260, ctr: 0.04, cpc: 310, cost: 80600, qualityScore: 5, conversions: 7, costPerConversion: 11514, searchImpressionShare: 0.29, conversionRate: 0.027 },
  { keywordId: '1007', keywordText: '壁掛けエアコン クリーニング', matchType: 'PHRASE', campaignName: 'エアコン洗浄_一般', adGroupName: '機種別', status: 'ENABLED', impressions: 1800, clicks: 126, ctr: 0.07, cpc: 360, cost: 45360, qualityScore: 7, conversions: 5, costPerConversion: 9072, searchImpressionShare: 0.51, conversionRate: 0.04 },
  { keywordId: '1008', keywordText: 'エアコン 丸洗い', matchType: 'BROAD', campaignName: 'エアコン洗浄_プレミアム', adGroupName: '分解・内部洗浄', status: 'PAUSED', impressions: 900, clicks: 27, ctr: 0.03, cpc: 400, cost: 10800, qualityScore: 4, conversions: 1, costPerConversion: 10800, searchImpressionShare: 0.18, conversionRate: 0.037 },
  { keywordId: '1009', keywordText: 'エアコンクリーニング 一台', matchType: 'EXACT', campaignName: 'エアコン洗浄_一般', adGroupName: '料金・費用', status: 'ENABLED', impressions: 4200, clicks: 378, ctr: 0.09, cpc: 295, cost: 111510, qualityScore: 8, conversions: 19, costPerConversion: 5869, searchImpressionShare: 0.74, conversionRate: 0.05 },
  { keywordId: '1010', keywordText: 'エアコン 洗浄 プロ', matchType: 'PHRASE', campaignName: 'エアコン洗浄_プレミアム', adGroupName: 'プロ・専門業者', status: 'ENABLED', impressions: 2700, clicks: 162, ctr: 0.06, cpc: 375, cost: 60750, qualityScore: 6, conversions: 6, costPerConversion: 10125, searchImpressionShare: 0.44, conversionRate: 0.037 },
];

const DEV_SAMPLE_NEGATIVE_KEYWORDS: GoogleAdsNegativeKeyword[] = [
  { keywordText: 'DIY', matchType: 'BROAD', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
  { keywordText: '自分で 掃除', matchType: 'PHRASE', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
  { keywordText: 'フィルター 掃除', matchType: 'PHRASE', level: 'ad_group', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED', adGroupName: 'クリーニング全般', adGroupStatus: 'ENABLED' },
  { keywordText: '中古 エアコン', matchType: 'BROAD', level: 'campaign', campaignName: 'エアコン洗浄_プレミアム', campaignStatus: 'ENABLED' },
  { keywordText: '無料', matchType: 'EXACT', level: 'campaign', campaignName: 'エアコン洗浄_一般', campaignStatus: 'ENABLED' },
];

const DEV_SAMPLE_SEARCH_TERMS: GoogleAdsSearchTermMetric[] = [
  { searchTerm: 'エアコンクリーニング', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3001', adGroupName: 'クリーニング全般', impressions: 3200, clicks: 128, cost: 40960, conversions: 6, conversionValue: 30000 },
  { searchTerm: 'エアコン クリーニング 料金', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3002', adGroupName: '料金・費用', impressions: 2100, clicks: 189, cost: 52920, conversions: 9, conversionValue: 45000 },
  { searchTerm: 'エアコン 掃除 業者 おすすめ', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3003', adGroupName: '業者選び', impressions: 1850, clicks: 92, cost: 28520, conversions: 3, conversionValue: 15000 },
  { searchTerm: 'エアコンクリーニング 一台 いくら', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3002', adGroupName: '料金・費用', impressions: 1620, clicks: 145, cost: 42775, conversions: 7, conversionValue: 35000 },
  { searchTerm: 'エアコン 分解洗浄 業者', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 980, clicks: 78, cost: 32760, conversions: 4, conversionValue: 20000 },
  { searchTerm: 'エアコン内部 カビ 掃除', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 870, clicks: 43, cost: 16770, conversions: 2, conversionValue: 10000 },
  { searchTerm: '壁掛けエアコン クリーニング 料金', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3005', adGroupName: '機種別', impressions: 760, clicks: 68, cost: 24480, conversions: 3, conversionValue: 15000 },
  { searchTerm: 'エアコン 臭い 洗浄', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 640, clicks: 38, cost: 15960, conversions: 1, conversionValue: 5000 },
  { searchTerm: 'エアコンクリーニング プロ 頼む', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3006', adGroupName: 'プロ・専門業者', impressions: 520, clicks: 46, cost: 17250, conversions: 2, conversionValue: 10000 },
  { searchTerm: 'エアコン 丸洗い 費用', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 410, clicks: 20, cost: 8000, conversions: 1, conversionValue: 5000 },
];

const DEV_SAMPLE_CONTENT_INVENTORY: ContentInventoryItem[] = [
  { id: 'ci-1', title: 'エアコンクリーニングの料金相場と内訳を徹底解説', url: 'https://sample-clean.jp/price', mainKw: 'エアコンクリーニング 料金', kw: 'エアコン 掃除 費用', categoryNames: ['料金'], excerpt: 'エアコンクリーニングの料金は機種や台数で変わります。本記事では相場と内訳を…' },
  { id: 'ci-2', title: '分解洗浄とは？通常クリーニングとの違い', url: 'https://sample-clean.jp/disassembly', mainKw: 'エアコン 分解洗浄', kw: '内部洗浄 違い', categoryNames: ['サービス'], excerpt: '分解洗浄は内部部品を取り外して洗う方法です。通常清掃との違いを…' },
  { id: 'ci-3', title: 'エアコン掃除を自分でやる方法と業者依頼の判断基準', url: 'https://sample-clean.jp/diy-or-pro', mainKw: 'エアコン 掃除 自分で', kw: 'DIY 業者 比較', categoryNames: ['お役立ち'], excerpt: '自分で掃除できる範囲と業者に頼むべきケースを整理します…' },
];

const DEV_SAMPLE_RANKING_SNAPSHOT: RankingSnapshotItem[] = [
  { queryNormalized: 'エアコンクリーニング 料金', position: 8, impressions: 1200, clicks: 96, url: 'https://sample-clean.jp/price', title: 'エアコンクリーニングの料金相場と内訳を徹底解説', contentAnnotationId: 'ci-1' },
  { queryNormalized: 'エアコン 分解洗浄', position: 22, impressions: 540, clicks: 12, url: 'https://sample-clean.jp/disassembly', title: '分解洗浄とは？通常クリーニングとの違い', contentAnnotationId: 'ci-2' },
  { queryNormalized: 'エアコン 掃除 自分で', position: 3, impressions: 2100, clicks: 210, url: 'https://sample-clean.jp/diy-or-pro', title: 'エアコン掃除を自分でやる方法と業者依頼の判断基準', contentAnnotationId: 'ci-3' },
  { queryNormalized: 'エアコン 掃除 業者 おすすめ', position: 35, impressions: 320, clicks: 4, url: 'https://sample-clean.jp/diy-or-pro', title: 'エアコン掃除を自分でやる方法と業者依頼の判断基準', contentAnnotationId: 'ci-3' },
];
