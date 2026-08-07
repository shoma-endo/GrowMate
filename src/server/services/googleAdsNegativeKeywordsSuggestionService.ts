import { marked } from 'marked';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';
import { MODEL_CONFIGS } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { llmChat } from '@/server/services/llmService';
import { briefService } from '@/server/services/briefService';
import { PromptService } from '@/server/services/promptService';
import { SupabaseService } from '@/server/services/supabaseService';
import { prepareNegativeKeywordsForPrompt } from '@/server/lib/google-ads-negative-keywords-prompt';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { EmailService, emailService as defaultEmailService } from '@/server/services/emailService';
import { CRON_DEFINITIONS } from '@/server/lib/cron-definitions';
import type {
  GoogleAdsNegativeKeyword,
  GoogleAdsSearchTermMetric,
} from '@/types/googleAds.types';
import type {
  GoogleAdsNegativeKeywordsSuggestionBatchResult,
  GoogleAdsNegativeKeywordsSuggestionResult,
} from '@/types/google-ads-negative-keywords-suggestion';

const DEFAULT_SEND_HOUR_JST = 7;
const CRON_CONCURRENCY = 3;
/**
 * cron route の Vercel 関数 maxDuration（秒）。Fluid Compute 上限（Pro プランで 800s）。
 * app/api/cron/google-ads-negative-keywords-suggestion/route.ts の `export const maxDuration` と
 * 時間予算の算出で共有する単一情報源。
 */
export const NEGATIVE_KEYWORDS_CRON_MAX_DURATION_SEC = 800;
const CRON_MAX_DURATION_MS = NEGATIVE_KEYWORDS_CRON_MAX_DURATION_SEC * 1000;
/**
 * 1ユーザーあたりの LLM 呼び出しタイムアウト（ミリ秒）。
 * llmChat の既定値 300000ms は関数上限と同等でガードとして機能しないため明示する。
 */
const LLM_TIMEOUT_MS = 240 * 1000;
/**
 * LLM 呼び出し以外（Google Ads API 取得・メール送信・DB 更新）の想定所要（ミリ秒）。
 * これらの呼び出しには個別タイムアウトがなく、undici の既定（300秒）まで待ちうるため、
 * 見積もりを置くだけでは上界にならない。USER_TIME_LIMIT_MS で実際に打ち切る。
 */
const CHUNK_IO_MARGIN_MS = 60 * 1000;
/**
 * 1ユーザーの処理全体の上限（ミリ秒）。これを超えたら結果を待たずに失敗として次へ進む。
 * Google Ads API / メール送信にタイムアウトが無いため、ここで上界を作らないと
 * 「予算 + 1チャンク < maxDuration」という時間予算の前提が成立しない。
 */
const USER_TIME_LIMIT_MS = LLM_TIMEOUT_MS + CHUNK_IO_MARGIN_MS;
/**
 * 集計とレスポンス生成のための余白（ミリ秒）。
 * これがないと予算ちょうどで開始したユーザーが上限まで粘ったとき maxDuration と同時刻になり、
 * レスポンスを返す前にハードキルされる（＝ cron 側は 504 を受け取り検証にすら到達しない）。
 */
const SAFETY_MARGIN_MS = 20 * 1000;
/**
 * バッチ処理の時間予算（ミリ秒）。
 * 時間チェックはチャンク開始「前」の 1 回だけなので、予算ギリギリで開始したチャンクが
 * 消費しうる最大時間（= USER_TIME_LIMIT_MS）を maxDuration から引いて求める。
 * 実測平均（1チャンク約150秒）ではなく上界で計算しないと Vercel のハードキルを踏む。
 * 打ち切った分は last_sent_on / last_attempted_on とも未更新で残るので、
 * 次の毎時 cron が同日中に回収する。
 */
const BATCH_TIME_LIMIT_MS = CRON_MAX_DURATION_MS - USER_TIME_LIMIT_MS - SAFETY_MARGIN_MS;

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

      // 成否によらずこの時点で「当日試行済み」を立てる。
      // 抽出条件を send_hour_jst <= 現在時刻 に緩めているため、これがないと
      // 恒久的に失敗するユーザー（未接続・メールバウンス等）が同日中ずっと再実行される。
      // 立てられなかった場合は同日中の重複送信を防げないため、処理自体を行わない。
      if (!force) {
        const claimed = await this.markAttempt(userId, todayJst);
        if (!claimed) {
          return {
            success: false,
            error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
          };
        }
      }

      const fail = async (error: string): Promise<GoogleAdsNegativeKeywordsSuggestionResult> => {
        if (!force) {
          await this.markFailure(userId, error);
        }
        return { success: false, error };
      };

      const userEmail = userResult.data.email;
      if (!userEmail) {
        return fail(ERROR_MESSAGES.GOOGLE_ADS.EMAIL_REQUIRED_FOR_NEGATIVE_KEYWORDS_SUGGESTION);
      }

      const dateRangeDays = options?.dateRangeDays ?? 1;
      const startDate = dateRangeDays > 1 ? addDaysISO(yesterdayJst, -(dateRangeDays - 1)) : yesterdayJst;
      const endDate = yesterdayJst;
      const previousEndDate = addDaysISO(startDate, -1);
      const previousStartDate = addDaysISO(startDate, -dateRangeDays);
      const useMockGoogleAds = process.env.NODE_ENV === 'development';

      let searchTerms: GoogleAdsSearchTermMetric[];
      let previousSearchTerms: GoogleAdsSearchTermMetric[];
      let negativeKeywords: GoogleAdsNegativeKeyword[];
      let brief: Awaited<ReturnType<typeof briefService.getVariablesByUserId>>;
      let customerName: string | null;

      if (useMockGoogleAds) {
        brief = await briefService.getVariablesByUserId(userId);
        searchTerms = DEV_SAMPLE_SEARCH_TERMS;
        previousSearchTerms = DEV_SAMPLE_SEARCH_TERMS_PREV;
        negativeKeywords = DEV_SAMPLE_NEGATIVE_KEYWORDS;
        customerName = 'サンプル株式会社（開発用）';
      } else {
        const credential = await this.supabaseService.getGoogleAdsCredential(userId);
        if (!credential) {
          return fail(ERROR_MESSAGES.GOOGLE_ADS.NOT_CONNECTED);
        }
        if (!credential.customerId) {
          return fail(ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED);
        }

        const accessToken = await this.ensureAccessToken(userId, credential);
        if (!accessToken) {
          return fail(ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED);
        }

        const [searchTermResult, negativeKeywordResult, briefResult, customerNameResult, previousSearchTermResult] =
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
            this.googleAdsService.getSearchTermMetrics({
              accessToken,
              customerId: credential.customerId,
              startDate: previousStartDate,
              endDate: previousEndDate,
              ...(credential.managerCustomerId && {
                loginCustomerId: credential.managerCustomerId,
              }),
            }),
          ]);

        // Google Ads API 由来のエラーは英語の生メッセージを含むことがあり、
        // last_send_error は設定画面にそのまま表示されるため定義済み文言を保存する。
        if (!searchTermResult.success) {
          console.error(
            '[GoogleAdsNegativeKeywordsSuggestionService] Failed to fetch search terms:',
            searchTermResult.error
          );
          return fail(ERROR_MESSAGES.GOOGLE_ADS.KEYWORD_METRICS_FETCH_FAILED);
        }
        if (!negativeKeywordResult.success) {
          console.error(
            '[GoogleAdsNegativeKeywordsSuggestionService] Failed to fetch negative keywords:',
            negativeKeywordResult.error
          );
          return fail(ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_FETCH_FAILED);
        }

        searchTerms = searchTermResult.data ?? [];
        negativeKeywords = negativeKeywordResult.data ?? [];
        brief = briefResult;
        customerName = customerNameResult;
        previousSearchTerms = previousSearchTermResult.success
          ? (previousSearchTermResult.data ?? [])
          : [];
      }

      const totalImpressions = searchTerms.reduce((sum, item) => sum + item.impressions, 0);
      if (totalImpressions === 0) {
        if (!force && !(await this.markSuccess(userId, todayJst))) {
          return {
            success: false,
            error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
          };
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

      const negativeKeywordPrompt = prepareNegativeKeywordsForPrompt(negativeKeywords, {
        aggregation: 'scoped',
      });
      console.info('[GoogleAdsNegativeKeywordsSuggestionService] negative keyword prompt load', {
        rawNegativeKw: negativeKeywordPrompt.rawNegativeKw,
        uniqueNegativeKw: negativeKeywordPrompt.uniqueNegativeKw,
        promptedNegativeKw: negativeKeywordPrompt.promptedNegativeKw,
        negativeKwChars: negativeKeywordPrompt.negativeKwChars,
      });

      const filledPrompt = buildPrompt(promptTemplate.content, {
        persona: brief?.persona?.trim() || '（ペルソナ未設定）',
        customerName: customerName ?? '',
        dateRange: `${startDate} 〜 ${endDate}`,
        searchTermData: this.formatSearchTermMetrics(searchTerms),
        existingNegativeKeywords: negativeKeywordPrompt.formatted,
        previousSearchTermData: this.formatSearchTermMetrics(previousSearchTerms),
        dayOverDayComparison: this.formatDayOverDay(
          previousSearchTerms,
          searchTerms,
          `${previousStartDate} 〜 ${previousEndDate}`,
          `${startDate} 〜 ${endDate}`
        ),
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
          timeoutMs: LLM_TIMEOUT_MS,
        }
      );

      // AI 生出力をそのまま本文に使うため、段落内の単一改行が HTML で潰れないよう
      // breaks:true を本呼び出しに限り付与する（リスト・見出し・表の描画には影響しない）。
      const htmlContent = sanitizeEmailHtml(await marked.parse(rawOutput, { breaks: true }));
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
        // 送信済みフラグの更新に失敗したら失敗として扱う（サイレントに成功と報告しない）。
        // 当日試行済みは既に立っているため、同日中に再送されることはない。
        const recorded = await this.markSuccess(userId, todayJst);
        if (!recorded) {
          return {
            success: false,
            error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_SETTINGS_UPDATE_FAILED,
          };
        }
      }

      return {
        success: true,
        message: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_EMAIL_SENT,
      };
    } catch (error) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Unexpected error:', error);
      if (!force) {
        // 例外メッセージ（Anthropic SDK の "Request was aborted." 等）は英語のまま
        // 設定画面に表示されるため、ユーザー向けには定義済み文言を保存する（生の内容は上で console.error 済み）。
        await this.markFailure(
          userId,
          ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED
        );
      }
      return {
        success: false,
        error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED,
      };
    }
  }

  async runAllDueSuggestions(): Promise<GoogleAdsNegativeKeywordsSuggestionBatchResult> {
    // 対象一覧の取得も関数の実行時間に含まれるため、DB 往復の前に起点を取る
    const startedAt = Date.now();
    CRON_DEFINITIONS.googleAdsNegativeKeywords.log('info', 'batch_started');
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
    let skippedDueToLimit = 0;

    for (let index = 0; index < dueResult.data.length; index += CRON_CONCURRENCY) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > BATCH_TIME_LIMIT_MS) {
        skippedDueToLimit = dueResult.data.length - index;
        console.warn(
          `[GoogleAdsNegativeKeywordsSuggestionService] Time limit reached (${elapsed}ms). ` +
            `Stopping batch. Remaining: ${skippedDueToLimit} users (will be retried by the next hourly cron).`
        );
        CRON_DEFINITIONS.googleAdsNegativeKeywords.log('warn', 'batch_time_budget_exceeded', {
          timeoutType: 'CRON_TIME_BUDGET_EXCEEDED',
          durationMs: elapsed,
          remaining: skippedDueToLimit,
        });
        break;
      }

      const chunk = dueResult.data.slice(index, index + CRON_CONCURRENCY);
      const chunkSettled = await Promise.allSettled(
        chunk.map(setting => this.runWithUserTimeLimit(setting.userId))
      );
      settled.push(...chunkSettled);
    }

    const summary = settled.reduce<GoogleAdsNegativeKeywordsSuggestionBatchResult>(
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

    if (skippedDueToLimit > 0) {
      const stoppedSummary = { ...summary, stoppedReason: 'time_limit' as const, skippedDueToLimit };
      this.logBatchCompleted(startedAt, stoppedSummary);
      return stoppedSummary;
    }

    this.logBatchCompleted(startedAt, summary);
    return summary;
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

  /**
   * 1ユーザーの処理に上限時間を設ける。超過したら結果を待たずに失敗として扱い、次のユーザーへ進む。
   * 進行中の処理自体は中断できない（Google Ads API / メール送信に signal を渡す口がない）ため、
   * バックグラウンドで走り続ける点は許容する。目的は関数全体が maxDuration を超えないこと。
   * last_attempted_on は既に立っているので、打ち切られたユーザーが同日中に再送されることはない。
   */
  private async runWithUserTimeLimit(
    userId: string
  ): Promise<GoogleAdsNegativeKeywordsSuggestionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        this.sendNegativeKeywordsSuggestionForUser(userId),
        new Promise<GoogleAdsNegativeKeywordsSuggestionResult>(resolve => {
          timer = setTimeout(() => {
            console.warn(
              `[GoogleAdsNegativeKeywordsSuggestionService] User time limit reached (${USER_TIME_LIMIT_MS}ms). Abandoning user ${userId}.`
            );
            CRON_DEFINITIONS.googleAdsNegativeKeywords.log('warn', 'job_timed_out', {
              operation: 'user_suggestion',
              timeoutType: 'JOB_TIMEOUT',
              durationMs: USER_TIME_LIMIT_MS,
            });
            resolve({
              success: false,
              error: ERROR_MESSAGES.GOOGLE_ADS.NEGATIVE_KEYWORDS_SUGGESTION_RUN_FAILED,
            });
          }, USER_TIME_LIMIT_MS);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private logBatchCompleted(
    startedAt: number,
    summary: GoogleAdsNegativeKeywordsSuggestionBatchResult
  ): void {
    CRON_DEFINITIONS.googleAdsNegativeKeywords.log('info', 'batch_completed', {
      durationMs: Date.now() - startedAt,
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
      skipped: summary.skipped,
    });
  }

  /** @returns 更新に成功したか */
  private async markAttempt(userId: string, todayJst: string): Promise<boolean> {
    const result = await this.supabaseService.updateGoogleAdsNegativeKeywordsSettings(userId, {
      last_attempted_on: todayJst,
    });
    if (!result.success) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Failed to mark attempt:', result.error);
      return false;
    }
    return true;
  }

  /** @returns 更新に成功したか */
  private async markSuccess(userId: string, todayJst: string): Promise<boolean> {
    const result = await this.supabaseService.updateGoogleAdsNegativeKeywordsSettings(userId, {
      last_sent_on: todayJst,
      last_send_error: null,
    });
    if (!result.success) {
      console.error('[GoogleAdsNegativeKeywordsSuggestionService] Failed to mark success:', result.error);
      return false;
    }
    return true;
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
    const header = [
      'search_term',
      'campaign_id',
      'campaign_name',
      'ad_group_id',
      'ad_group_name',
      'impressions',
      'clicks',
      'cost_yen',
      'conversions',
      'conversion_value_yen',
    ];
    if (metrics.length === 0) {
      return `${header.join(',')}\n`;
    }

    const rows = [...metrics]
      .sort((a, b) => b.impressions - a.impressions)
      .map(metric =>
        [
          metric.searchTerm,
          metric.campaignId,
          metric.campaignName,
          metric.adGroupId,
          metric.adGroupName,
          metric.impressions,
          metric.clicks,
          Math.round(metric.cost),
          metric.conversions,
          Math.round(metric.conversionValue),
        ]
          .map(value => this.csvEscape(value))
          .join(',')
      );

    return [header.join(','), ...rows].join('\n');
  }

  private aggregateMetrics(metrics: GoogleAdsSearchTermMetric[]): {
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    conversionValue: number;
  } {
    return metrics.reduce(
      (acc, metric) => ({
        impressions: acc.impressions + metric.impressions,
        clicks: acc.clicks + metric.clicks,
        cost: acc.cost + metric.cost,
        conversions: acc.conversions + metric.conversions,
        conversionValue: acc.conversionValue + metric.conversionValue,
      }),
      { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 }
    );
  }

  private formatDayOverDay(
    previous: GoogleAdsSearchTermMetric[],
    current: GoogleAdsSearchTermMetric[],
    previousLabel: string,
    currentLabel: string
  ): string {
    if (previous.length === 0) {
      return `前期間（${previousLabel}）のデータを取得できなかったため、前日比は算出できません。`;
    }
    const prev = this.aggregateMetrics(previous);
    const cur = this.aggregateMetrics(current);
    const delta = (before: number, after: number): string => {
      const diff = after - before;
      const sign = diff > 0 ? '+' : '';
      return `${sign}${this.formatNumber(diff)}`;
    };
    const lines = [
      `前々日（${previousLabel}） → 前日（${currentLabel}）`,
      `- 広告費: ¥${this.formatInteger(prev.cost)} → ¥${this.formatInteger(cur.cost)}（差分 ${delta(prev.cost, cur.cost)}）`,
      `- クリック: ${this.formatInteger(prev.clicks)} → ${this.formatInteger(cur.clicks)}（差分 ${delta(prev.clicks, cur.clicks)}）`,
      `- コンバージョン: ${this.formatNumber(prev.conversions)} → ${this.formatNumber(cur.conversions)}（差分 ${delta(prev.conversions, cur.conversions)}）`,
      `- CV値: ¥${this.formatInteger(prev.conversionValue)} → ¥${this.formatInteger(cur.conversionValue)}（差分 ${delta(prev.conversionValue, cur.conversionValue)}）`,
    ];
    return lines.join('\n');
  }

  private csvEscape(value: string | number): string {
    const text = String(value);
    if (!/[",\r\n]/.test(text)) {
      return text;
    }
    return `"${text.replaceAll('"', '""')}"`;
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
  { searchTerm: '家具 買取 アルバイト', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 1280, clicks: 32, cost: 12400, conversions: 0, conversionValue: 0 },
  { searchTerm: '古銭 価値 調べ方', campaignId: '2002', campaignName: '骨董品買取_一般', adGroupId: '3002', adGroupName: '古銭買取', impressions: 940, clicks: 0, cost: 0, conversions: 0, conversionValue: 0 },
  { searchTerm: '他社ブランド 買取 評判', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3003', adGroupName: 'ブランド家具', impressions: 410, clicks: 8, cost: 3200, conversions: 0, conversionValue: 0 },
  { searchTerm: '出張 買取 家具', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 860, clicks: 74, cost: 26640, conversions: 5, conversionValue: 25000 },
  { searchTerm: 'アンティーク 時計 買取', campaignId: '2002', campaignName: '骨董品買取_一般', adGroupId: '3004', adGroupName: '時計買取', impressions: 620, clicks: 49, cost: 19600, conversions: 3, conversionValue: 15000 },
];

const DEV_SAMPLE_SEARCH_TERMS_PREV: GoogleAdsSearchTermMetric[] = [
  { searchTerm: '家具 買取 アルバイト', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 1100, clicks: 20, cost: 8200, conversions: 0, conversionValue: 0 },
  { searchTerm: '出張 買取 家具', campaignId: '2001', campaignName: '家具買取_一般', adGroupId: '3001', adGroupName: '家具買取', impressions: 790, clicks: 60, cost: 21800, conversions: 4, conversionValue: 20000 },
  { searchTerm: 'アンティーク 時計 買取', campaignId: '2002', campaignName: '骨董品買取_一般', adGroupId: '3004', adGroupName: '時計買取', impressions: 540, clicks: 41, cost: 16400, conversions: 2, conversionValue: 10000 },
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
