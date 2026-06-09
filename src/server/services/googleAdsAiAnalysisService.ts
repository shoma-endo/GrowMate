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

/**
 * §17.4: 既存コンテンツ在庫の突合インデックス。
 * - byMainKw / byKw: 正規化キー → 記事。優先順（main_kw > kw）保証のため別Mapに分離する。
 * - articles: タイトル全トークン包含フォールバック用に正規化タイトルを保持。
 */
interface InventoryIndex {
  byMainKw: Map<string, ContentInventoryItem>;
  byKw: Map<string, ContentInventoryItem>;
  // 空白位置のゆれ（例「平飼い 卵 危険」↔「平飼い卵 危険」）を吸収する空白除去キー。
  byMainKwCompact: Map<string, ContentInventoryItem>;
  byKwCompact: Map<string, ContentInventoryItem>;
  // §17.4-B: AI名指し target_url の実在検証用。正規化URL → 記事。
  byUrl: Map<string, ContentInventoryItem>;
  articles: { item: ContentInventoryItem; normalizedTitle: string; compactTitle: string }[];
}

/**
 * §17.4-A: 正規化（normalizeQuery）後に空白を全除去した突合キー。
 * 日本語KWの空白位置ゆれ（「平飼い 卵 危険」↔「平飼い卵 危険」）を吸収するための補助キー。
 * 突合（在庫）専用。GSC query_normalized 側は変更しない。
 */
function compactKey(value: string): string {
  return normalizeQuery(value).replace(/[\s　]+/g, '');
}

/**
 * §17.4-B: URL突合用の正規化キー。scheme/www/末尾スラッシュ/クエリ/フラグメントの揺れを吸収する。
 * AIが名指しした target_url と在庫の canonical_url/normalized_url を緩く一致させるため。
 */
function normalizeUrlKey(value: string): string {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

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
      // §17.4-B: 既存修正の対象記事URL（任意）。空文字や非文字列は未指定扱い。
      const targetUrl =
        typeof record.target_url === 'string' && record.target_url.trim().length > 0
          ? record.target_url.trim()
          : undefined;
      return [{ rank, mainKw, subKws, ...(targetUrl ? { targetUrl } : {}) }];
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
  // §17.4: 「コード突合」と「プロンプト送付」を分離する。
  // - 順位突合は AI 実行後に提案KWだけを狙い撃ち取得（getRankingForQueries）するため取得上限なし。
  // - 在庫突合は軽量全件（タイトル包含のため）。プロンプトはトークン制御のため上位を抜粋する。
  private static readonly RANKING_SNAPSHOT_PROMPT_LIMIT = 500; // プロンプト rankingData 用（上位抜粋）
  private static readonly CONTENT_INVENTORY_PROMPT_LIMIT = 100; // プロンプト existingContent 用（§17.4-B: AIが対象記事を名指せるよう可視範囲を拡大）
  // 検索語句: 取得は広めプール（impression上位）を取り、プロンプトには多様性・情報寄りで絞った上位のみ渡す。
  private static readonly SEARCH_TERM_FETCH_POOL = 5000; // GAQL 取得上限（選別母集団）
  private static readonly SEARCH_TERM_PROMPT_LIMIT = 1500; // プロンプト投入上限（キュレーション後）
  // 除外KW: 大規模口座（数万件）でプロンプトが溢れるため、CSV化に加え投入件数を上限で抑える。
  private static readonly NEGATIVE_KEYWORD_PROMPT_LIMIT = 2000;

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
        const emailMarkdown = this.composeEmailMarkdown(
          analysisMarkdown,
          DEV_SAMPLE_RANKING_SNAPSHOT,
          DEV_SAMPLE_CONTENT_INVENTORY
        );
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
        contentInventoryMatchResult,
        rankingSnapshotResult,
        customerName,
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
          // 選別母集団を広めに取得し、プロンプトには後段でキュレーションして絞る。
          limit: GoogleAdsAiAnalysisService.SEARCH_TERM_FETCH_POOL,
          ...(credential.managerCustomerId && {
            loginCustomerId: credential.managerCustomerId,
          }),
        }),
        briefService.getVariablesByUserId(userId),
        // プロンプト用（抜粋付き・上位N件）
        this.supabaseService.getContentInventoryByUserId(
          userId,
          GoogleAdsAiAnalysisService.CONTENT_INVENTORY_PROMPT_LIMIT
        ),
        // 突合用（軽量・全件に近い母集団。プロンプトには渡さない）
        this.supabaseService.getContentInventoryForMatching(userId),
        // プロンプト rankingData 用の上位抜粋。順位の突合は後段で提案KWを狙い撃ちする。
        this.supabaseService.getRankingSnapshotByUserId(
          userId,
          GoogleAdsAiAnalysisService.RANKING_SNAPSHOT_PROMPT_LIMIT,
          dateRangeDays
        ),
        // 顧客名解決（Google Ads API）も独立データのため並列化する。
        // resolveCustomerName は内部で例外を握り潰し null を返すため Promise.all を巻き込まない。
        this.resolveCustomerName({
          accessToken,
          customerId: credential.customerId,
          managerCustomerId: credential.managerCustomerId,
        }),
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
      if (!contentInventoryMatchResult.success) {
        console.warn(
          '[GoogleAdsAiAnalysisService] Failed to fetch content inventory for matching (non-fatal):',
          contentInventoryMatchResult.error
        );
      }
      if (!rankingSnapshotResult.success) {
        console.warn(
          '[GoogleAdsAiAnalysisService] Failed to fetch ranking snapshot (non-fatal):',
          rankingSnapshotResult.error
        );
      }

      // §17: 1実行ぶんの入力データ健全性スナップショット（機密は含めず件数と成否のみ）。
      // ok=false は取得失敗、ok=true かつ count=0 は「連携済みだがデータ0件（GSC未連携・WP未取込）」を意味し、
      // existingContent / rankingData が空でAIに渡ることを本番ログで切り分けられる。
      console.info('[GoogleAdsAiAnalysisService] analysis input summary', {
        keywordCount: keywordResult.data?.length ?? 0,
        negativeKeywordCount: negativeKeywordResult.data?.length ?? 0,
        searchTermOk: searchTermResult.success,
        searchTermCount: searchTermResult.success ? (searchTermResult.data?.length ?? 0) : 0,
        contentInventoryOk: contentInventoryResult.success,
        contentInventoryCount: contentInventoryResult.success
          ? (contentInventoryResult.data?.length ?? 0)
          : 0,
        // 突合用（コード側）の母集団件数。プロンプト件数とは別軸で観測する。
        contentInventoryMatchCount: contentInventoryMatchResult.success
          ? (contentInventoryMatchResult.data?.length ?? 0)
          : 0,
        rankingSnapshotOk: rankingSnapshotResult.success,
        // プロンプト rankingData 用の上位抜粋件数（順位の突合は AI 後の狙い撃ちで別途実施）。
        rankingSnapshotCount: rankingSnapshotResult.success
          ? (rankingSnapshotResult.data?.length ?? 0)
          : 0,
      });

      const promptTemplate = await PromptService.getTemplateByName('google_ads_ai_evaluation');
      if (!promptTemplate) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_PROMPT_NOT_FOUND,
        };
      }

      const targetService = this.resolveTargetService(brief, options?.serviceId);
      if (!targetService) {
        return {
          success: false,
          error: ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SERVICE_REQUIRED,
        };
      }

      // 「突合とプロンプトの分離」:
      // - 在庫突合は軽量全件（matchInventory）。取得失敗時は取得済みのプロンプト用在庫(上位50)へ
      //   フォールバックし、従来より記事リンクが減る回帰を防ぐ。
      // - 順位突合は AI 実行後に提案KWを狙い撃ち取得する（取得上限なし）。
      // - プロンプトには上位抜粋のみ渡す＝トークン制御。
      const matchInventory = contentInventoryMatchResult.success
        ? contentInventoryMatchResult.data
        : contentInventoryResult.success
          ? contentInventoryResult.data
          : [];

      // §除外KW: プロンプトに入る除外KWテーブルの実負荷を可観測化する（トークン肥大の監視）。
      // raw（API取得）→ deduped（完全重複除去後＝実際にプロンプトへ入る行数）→ chars（整形後の文字数）。
      const negativeKeywordsRaw = negativeKeywordResult.data ?? [];
      const negativeKeywordsFormatted = this.formatNegativeKeywords(negativeKeywordsRaw);
      const dedupedNegativeKwCount = dedupeNegativeKeywords(negativeKeywordsRaw).length;
      console.info('[GoogleAdsAiAnalysisService] negative keyword prompt load', {
        rawNegativeKw: negativeKeywordsRaw.length,
        dedupedNegativeKw: dedupedNegativeKwCount,
        // 実際にプロンプトへ載せた件数（上限適用後）。
        promptedNegativeKw: Math.min(
          dedupedNegativeKwCount,
          GoogleAdsAiAnalysisService.NEGATIVE_KEYWORD_PROMPT_LIMIT
        ),
        negativeKwChars: negativeKeywordsFormatted.length,
      });

      // 検索語句: impression上位プールから、多様性（キャンペーン横断）・情報寄りで投入数を絞る。
      const searchTermPool = searchTermResult.data ?? [];
      const curatedSearchTerms = this.curateSearchTermsForPrompt(
        searchTermPool,
        GoogleAdsAiAnalysisService.SEARCH_TERM_PROMPT_LIMIT
      );
      console.info('[GoogleAdsAiAnalysisService] search term prompt load', {
        searchTermPool: searchTermPool.length,
        searchTermCurated: curatedSearchTerms.length,
      });

      const filledPrompt = buildAnalysisPrompt(promptTemplate.content, {
        persona: brief?.persona?.trim() || '（ペルソナ未設定）',
        serviceName: targetService.name,
        strength: this.formatStrength(targetService),
        keywordData: this.formatKeywordMetrics(keywordResult.data ?? []),
        negativeKeywords: negativeKeywordsFormatted,
        searchTermData: this.formatSearchTermMetrics(curatedSearchTerms),
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

      // 順位突合は提案KWを狙い撃ち取得する（取得上限なし＝該当順位の取りこぼしを防ぐ）。
      const proposalKws = [
        ...new Set(
          (extractTopProposals(analysisMarkdown) ?? [])
            .flatMap(proposal => [proposal.mainKw, ...proposal.subKws])
            .map(kw => normalizeQuery(kw))
            .filter(kw => kw.length > 0)
        ),
      ];
      const rankingForMatchResult = await this.supabaseService.getRankingForQueries(
        userId,
        dateRangeDays,
        proposalKws
      );
      // 狙い撃ち取得が失敗（新RPC未適用・DB障害・デプロイ順序）でも、取得済みのプロンプト用上位500件へ
      // フォールバックし、順位リンクが従来より消える回帰を防ぐ。
      const rankingForMatch = rankingForMatchResult.success
        ? rankingForMatchResult.data
        : rankingSnapshotResult.success
          ? rankingSnapshotResult.data
          : [];
      console.info('[GoogleAdsAiAnalysisService] targeted ranking lookup', {
        requestedQueries: proposalKws.length,
        // 狙い撃ちの実マッチ数（フォールバック後の件数を混ぜない）。
        matchedQueries: rankingForMatchResult.success ? rankingForMatchResult.data.length : 0,
        ok: rankingForMatchResult.success,
        // 実際にプロンプト用500へフォールバックできたときのみ true（プロンプト用も失敗なら false）。
        fallbackToPromptSnapshot:
          !rankingForMatchResult.success && rankingSnapshotResult.success,
        // 在庫突合の観測値（全件ページングが効いているかを本番で確認するため）。
        inventoryForMatch: matchInventory.length,
        inventoryMatchFetchOk: contentInventoryMatchResult.success,
        // 全件取得に失敗しプロンプト用(上位50)へ退避したときのみ true。
        inventoryFellBackToPrompt:
          !contentInventoryMatchResult.success && contentInventoryResult.success,
      });

      // メール記事リンクの突合: 順位は狙い撃ち結果、在庫は軽量全件で行う。
      const emailMarkdown = this.composeEmailMarkdown(
        analysisMarkdown,
        rankingForMatch,
        matchInventory
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

  /** CSV セル化: 区切り文字・引用符・改行を含む値のみ二重引用符で囲み内部引用符をエスケープ。 */
  private csvCell(value: string): string {
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  /**
   * 除外KWをプロンプト用に整形する。大規模口座（数万件）でトークンが溢れるため:
   * - 件数: campaign（戦略的・広域）→ ad_group（戦術的・件数膨張源）の優先順で上位 N 件に制限。
   * - 形式: CSV（パイプ表よりトークン節約。空欄は "-" でなく空文字）。
   * - 省略分は無言で消さず件数を明記する（docs/context の原則(d)）。
   */
  private formatNegativeKeywords(keywords: GoogleAdsNegativeKeyword[]): string {
    const deduped = dedupeNegativeKeywords(keywords);
    const header =
      '除外キーワード,マッチタイプ,レベル,キャンペーン,キャンペーン状態,広告グループ,広告グループ状態';

    if (deduped.length === 0) {
      return `${header}\n（除外キーワードなし）`;
    }

    // campaign を ad_group より優先（安定ソートで同レベル内は dedupe 順を保持＝決定的）。
    const levelRank: Record<GoogleAdsNegativeKeyword['level'], number> = {
      campaign: 0,
      ad_group: 1,
    };
    const ordered = [...deduped].sort((a, b) => levelRank[a.level] - levelRank[b.level]);
    const limit = GoogleAdsAiAnalysisService.NEGATIVE_KEYWORD_PROMPT_LIMIT;
    const capped = ordered.slice(0, limit);
    const omitted = ordered.length - capped.length;

    const rows = capped.map(keyword =>
      [
        keyword.keywordText,
        keyword.matchType,
        keyword.level,
        keyword.campaignName || '',
        keyword.campaignStatus || '',
        keyword.adGroupName || '',
        keyword.adGroupStatus || '',
      ]
        .map(cell => this.csvCell(cell))
        .join(',')
    );

    const lines = [header, ...rows];
    if (omitted > 0) {
      lines.push(
        `（ほか ${this.formatInteger(omitted)} 件は省略。campaign→ad_group の優先順で上位 ${this.formatInteger(limit)} 件を掲載）`
      );
    }
    return lines.join('\n');
  }

  // 検索語句キュレーション用の語彙。コンテンツ機会に効く情報系を加点、純購買・ブランド系を減点する。
  private static readonly SEARCH_TERM_INFO_MODIFIERS = [
    'とは', '方法', 'やり方', '違い', '比較', '危険', 'デメリット', 'メリット', '効果',
    '原因', '対処', '選び方', 'おすすめ', '自分で', '相場', '料金', '頻度', '時期',
    '必要', 'なぜ', 'どう', '口コミ', '評判',
  ];
  private static readonly SEARCH_TERM_TRANSACTIONAL_TERMS = [
    '通販', '購入', '注文', '店舗', 'クーポン', '送料', '定期便', 'お試し', '楽天', 'amazon',
  ];

  /**
   * §検索語句: impression上位プールから、プロンプト投入ぶんを「多様性＋情報寄り」で選別する。
   * - (a) キャンペーン横断のラウンドロビンで1キャンペーン独占を防ぐ。
   * - (d) 情報系修飾を含む語をグループ内で優先（コンテンツ機会）。
   * - (b) 純購買・ブランド系は後回し（除外でなく減点）。
   * 同点は impression 降順。決定的（安定ソート前提）。
   */
  private curateSearchTermsForPrompt(
    metrics: GoogleAdsSearchTermMetric[],
    maxRows: number
  ): GoogleAdsSearchTermMetric[] {
    if (metrics.length <= maxRows) {
      return metrics;
    }

    const isInfo = (term: string): boolean =>
      GoogleAdsAiAnalysisService.SEARCH_TERM_INFO_MODIFIERS.some(m => term.includes(m));
    const isTransactional = (term: string): boolean =>
      GoogleAdsAiAnalysisService.SEARCH_TERM_TRANSACTIONAL_TERMS.some(t => term.includes(t));

    // キャンペーン単位でグループ化し、各グループ内を「情報系→非購買→impression降順」で並べる。
    // 同名キャンペーンの統合を避けるため一意の campaignId をキーにする（空なら名前にフォールバック）。
    const groups = new Map<string, GoogleAdsSearchTermMetric[]>();
    for (const metric of metrics) {
      const key = metric.campaignId || metric.campaignName || '-';
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(metric);
      } else {
        groups.set(key, [metric]);
      }
    }
    for (const bucket of groups.values()) {
      bucket.sort((a, b) => {
        const infoDiff = Number(isInfo(b.searchTerm)) - Number(isInfo(a.searchTerm));
        if (infoDiff !== 0) return infoDiff;
        const txnDiff = Number(isTransactional(a.searchTerm)) - Number(isTransactional(b.searchTerm));
        if (txnDiff !== 0) return txnDiff;
        return b.impressions - a.impressions;
      });
    }

    // ラウンドロビン: 各キャンペーンから1件ずつ巡回採用し、maxRows まで埋める。
    const buckets = [...groups.values()];
    const selected: GoogleAdsSearchTermMetric[] = [];
    for (let i = 0; selected.length < maxRows; i++) {
      let advanced = false;
      for (const bucket of buckets) {
        if (i < bucket.length) {
          selected.push(bucket[i]!);
          advanced = true;
          if (selected.length >= maxRows) break;
        }
      }
      if (!advanced) break; // 全グループ枯渇
    }
    return selected;
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
   * §17.4 Increment2: 正規化クエリ → 順位スナップショットの索引を作る。
   * 同一正規化クエリは上位（position 昇順で取得済み）を代表とする。
   */
  private buildSnapshotMap(
    rankingSnapshot: RankingSnapshotItem[]
  ): Map<string, RankingSnapshotItem> {
    const snapshotByQuery = new Map<string, RankingSnapshotItem>();
    for (const item of rankingSnapshot) {
      const key = normalizeQuery(item.queryNormalized);
      if (!snapshotByQuery.has(key)) {
        snapshotByQuery.set(key, item);
      }
    }
    return snapshotByQuery;
  }

  /**
   * §17.4: 既存コンテンツ在庫を突合用に索引する。
   * main_kw だけでなく kw（参考KW群）も完全一致キーに含め、タイトルは部分一致用に保持する。
   * GSC に順位が無くても既存記事の有無・タイトル・URL を提示するための突合に使う。
   */
  private buildInventoryIndex(contentInventory: ContentInventoryItem[]): InventoryIndex {
    const byMainKw = new Map<string, ContentInventoryItem>();
    const byKw = new Map<string, ContentInventoryItem>();
    const byMainKwCompact = new Map<string, ContentInventoryItem>();
    const byKwCompact = new Map<string, ContentInventoryItem>();
    const byUrl = new Map<string, ContentInventoryItem>();
    const articles: InventoryIndex['articles'] = [];
    for (const item of contentInventory) {
      const urlKey = normalizeUrlKey(item.url ?? '');
      if (urlKey && !byUrl.has(urlKey)) {
        byUrl.set(urlKey, item);
      }
      const mainKey = normalizeQuery(item.mainKw ?? '');
      if (mainKey && !byMainKw.has(mainKey)) {
        byMainKw.set(mainKey, item);
      }
      const mainCompact = compactKey(item.mainKw ?? '');
      if (mainCompact && !byMainKwCompact.has(mainCompact)) {
        byMainKwCompact.set(mainCompact, item);
      }
      if (item.kw) {
        for (const token of item.kw.split(/[\n,、/／・]/)) {
          const key = normalizeQuery(token);
          if (key && !byKw.has(key)) {
            byKw.set(key, item);
          }
          const compact = compactKey(token);
          if (compact && !byKwCompact.has(compact)) {
            byKwCompact.set(compact, item);
          }
        }
      }
      articles.push({
        item,
        normalizedTitle: normalizeQuery(item.title ?? ''),
        compactTitle: compactKey(item.title ?? ''),
      });
    }
    return { byMainKw, byKw, byMainKwCompact, byKwCompact, byUrl, articles };
  }

  /**
   * §17.4-B: AIが名指しした target_url を在庫(content_annotations)で実在検証して記事を返す。
   * 在庫に無いURL（未取込ページ・AIの言い間違い）は undefined（表示しない＝捏造防止）。
   */
  private resolveArticleByUrl(
    url: string | undefined,
    index: InventoryIndex
  ): ContentInventoryItem | undefined {
    const key = normalizeUrlKey(url ?? '');
    if (!key) {
      return undefined;
    }
    return index.byUrl.get(key);
  }

  /**
   * §17.4: 提案KWに対応する既存記事を解決する（先勝ち）。
   * ① main_kw 完全一致 → ② kw 完全一致 → ③ 空白除去で main_kw/kw 一致（表記ゆれ吸収）
   *   → ④ タイトル全トークン包含（2トークン以上で誤マッチ抑制・空白除去で比較）。
   * main_kw を kw より優先するため、両者は別Mapに分けて順に検索する。
   * AI の「既存修正」判定（意味的）に、コード側の突合が追従できるよう緩和したもの。
   * ③④の空白除去は「平飼い 卵 危険」↔「平飼い卵 危険」型のゆれを救う（§17.4-A）。
   */
  private resolveInventoryArticle(
    kw: string,
    index: InventoryIndex
  ): ContentInventoryItem | undefined {
    const normalizedKey = normalizeQuery(kw);
    const exactMainKw = index.byMainKw.get(normalizedKey);
    if (exactMainKw) {
      return exactMainKw;
    }
    const exactKw = index.byKw.get(normalizedKey);
    if (exactKw) {
      return exactKw;
    }

    // ③ 空白位置のゆれを吸収（例: KW「平飼い卵 危険」↔ main_kw「平飼い 卵 危険」）。
    const compactQuery = compactKey(kw);
    if (compactQuery) {
      const compactMain = index.byMainKwCompact.get(compactQuery);
      if (compactMain) {
        return compactMain;
      }
      const compactKwHit = index.byKwCompact.get(compactQuery);
      if (compactKwHit) {
        return compactKwHit;
      }
    }

    // ④ タイトル全トークン包含フォールバック。1トークンの汎用語での誤マッチを避けるため2トークン以上に限定。
    // 空白除去後のタイトル/トークンで比較し、表記ゆれ（平飼い卵↔平飼い 卵）を吸収する。
    const tokens = kw
      .split(/[\s　]+/)
      .map(token => compactKey(token))
      .filter(token => token.length > 0);
    if (tokens.length < 2) {
      return undefined;
    }
    const found = index.articles.find(
      ({ compactTitle }) =>
        compactTitle.length > 0 && tokens.every(token => compactTitle.includes(token))
    );
    return found?.item;
  }

  /**
   * 1KWの順位ブロックを生成する。検索順位・タイトル・URL はコード側が事実から組み立てる（捏造防止）。
   * marked は breaks:false（既定）のため段落内の単一改行は潰れる。行分割の Markdown リストで生成する。
   */
  private renderKwRanking(
    label: string,
    kw: string,
    snapshotByQuery: Map<string, RankingSnapshotItem>,
    inventoryIndex: InventoryIndex,
    targetArticle?: ContentInventoryItem
  ): string {
    const normalized = normalizeQuery(kw);

    // 上部の「対象既存記事」と同一記事なら、KW行ではタイトル/URLを再掲せず順位情報のみに絞る（重複表示の解消）。
    const isTarget = (annotationId: string | null, articleId?: string): boolean =>
      targetArticle !== undefined &&
      ((annotationId !== null && annotationId === targetArticle.id) ||
        (articleId !== undefined && articleId === targetArticle.id));

    // 1) GSC 順位あり → 検索順位（＋対象記事と別ページのときのみタイトル・URL）
    const matched = snapshotByQuery.get(normalized);
    if (matched) {
      const items = [`- 検索順位：${this.formatNumber(matched.position)}位`];
      if (!isTarget(matched.contentAnnotationId)) {
        if (matched.title) {
          items.push(`- タイトル：${matched.title}`);
        }
        if (matched.url) {
          items.push(`- ${matched.url}`);
        }
      }
      return [`**${label} ${kw}**`, '', ...items].join('\n');
    }

    // 2) GSC 順位は無いが既存記事（WP在庫）あり → 記事の有無を提示（対象記事と別記事のときのみタイトル・URL）
    const article = this.resolveInventoryArticle(kw, inventoryIndex);
    if (article) {
      const items = ['- 既存記事あり（検索順位データなし）'];
      if (!isTarget(null, article.id)) {
        if (article.title) {
          items.push(`- タイトル：${article.title}`);
        }
        if (article.url) {
          items.push(`- ${article.url}`);
        }
      }
      return [`**${label} ${kw}**`, '', ...items].join('\n');
    }

    // 3) どちらも無し（GSC未連携・圏外でも既存記事は存在し得るため「新規候補」とは断定しない）
    return `**${label} ${kw}**\n\n- 順位データなし`;
  }

  /**
   * §17.4 Increment2: 1提案ぶんの「既存コンテンツの順位」ブロックを生成する。
   * 提案内の全KWが未マッチなら「順位データなし」を各KWに繰り返さず1行へ集約する。
   */
  private buildProposalRankingBlock(
    proposal: TopProposalKeyword,
    snapshotByQuery: Map<string, RankingSnapshotItem>,
    inventoryIndex: InventoryIndex
  ): string {
    const heading = '**▼ 既存コンテンツの順位 ▼**';

    // §17.4-B: AIが名指しした「既存修正の対象記事」を在庫で実在検証して提示する（提案単位・1件）。
    // 在庫に無いURL（未取込ページ・AIの言い間違い）は表示しない＝捏造防止。
    const targetArticle = this.resolveArticleByUrl(proposal.targetUrl, inventoryIndex);
    const targetBlock = targetArticle
      ? [
          '**▼ 対象既存記事（既存修正の対象）▼**',
          [
            targetArticle.title ? `- タイトル：${targetArticle.title}` : null,
            targetArticle.url ? `- ${targetArticle.url}` : null,
          ]
            .filter((line): line is string => line !== null)
            .join('\n'),
        ].join('\n\n')
      : null;

    const allKws = [proposal.mainKw, ...proposal.subKws];
    // GSC順位・WP在庫のいずれかに一致するKWがあるか
    const anyMatched = allKws.some(
      kw =>
        snapshotByQuery.has(normalizeQuery(kw)) ||
        this.resolveInventoryArticle(kw, inventoryIndex) !== undefined
    );
    if (!anyMatched) {
      // KW別はマッチ無し。AI名指しの対象記事があれば「既存有無」として提示する。
      const tail = targetBlock
        ? [targetBlock, '- 各キーワードの検索順位データはなし']
        : ['- 全キーワードで順位データなし'];
      return [heading, '', ...tail].join('\n\n');
    }

    const parts = [
      this.renderKwRanking(
        '▼ メインKW ▼',
        proposal.mainKw,
        snapshotByQuery,
        inventoryIndex,
        targetArticle
      ),
    ];
    if (proposal.subKws.length > 0) {
      parts.push('**▼ サブKW ▼**');
      parts.push(
        ...proposal.subKws.map(kw =>
          this.renderKwRanking('・', kw, snapshotByQuery, inventoryIndex, targetArticle)
        )
      );
    }
    return [heading, '', ...(targetBlock ? [targetBlock] : []), ...parts].join('\n\n');
  }

  /**
   * §17.4 Increment2: AI 出力（Markdown）から JSON ブロックを取り除き、
   * 各提案の「▼ 新規作成 / 既存修正の判定 ▼」見出しをアンカーに、その判定ブロック直後へ
   * その提案の順位ブロックをコード側で差し込む（プロンプトに特殊記法は不要）。
   * - 見出しが見つからない場合は末尾に「## 現状成績」セクションとしてまとめて付記する（フォールバック）。
   * - JSON が無い／パース不能な場合は順位表を付けず本文のみを返す（非致命・従来挙動）。
   */
  private composeEmailMarkdown(
    analysisMarkdown: string,
    rankingSnapshot: RankingSnapshotItem[],
    contentInventory: ContentInventoryItem[]
  ): string {
    const proposals = extractTopProposals(analysisMarkdown);
    const body = stripJsonBlock(analysisMarkdown);
    if (!proposals) {
      // 末尾JSONが無い／壊れている＝順位表を付けられない。出力切れ等を疑う検知ポイント。
      console.warn(
        '[GoogleAdsAiAnalysisService] ranking table skipped: TOP5 JSON not found/parseable',
        { markdownLength: analysisMarkdown.length }
      );
      return body;
    }

    const snapshotByQuery = this.buildSnapshotMap(rankingSnapshot);
    const inventoryIndex = this.buildInventoryIndex(contentInventory);
    const hasSnapshot = rankingSnapshot.length > 0;
    const sorted = [...proposals].sort((a, b) => a.rank - b.rank);

    // §17.4-B 可観測性: AIが名指しした対象記事URLを在庫で解決できたかを集計（本番検証用）。
    const targetNamed = sorted.filter(p => (p.targetUrl ?? '').length > 0).length;
    const targetResolved = sorted.filter(
      p => this.resolveArticleByUrl(p.targetUrl, inventoryIndex) !== undefined
    ).length;
    console.info('[GoogleAdsAiAnalysisService] target article resolution', {
      proposals: sorted.length,
      named: targetNamed, // target_url を出した提案数（＝AIが既存修正対象を名指し）
      resolved: targetResolved, // 在庫で実在解決できた数（＝メールに対象既存記事を表示）
      unresolvedNamed: targetNamed - targetResolved, // 名指しされたが在庫に無い（未取込/言い間違い）
    });

    // 「優先順位N位」アンカーで提案を明示対応づけ、判定ブロック直後へ順位ブロックを差し込む。
    // 出現順では見出し欠落時に別提案の事実が混入し得るため、rank で対応づけて誤帰属を防ぐ。
    const { body: injectedBody, injectedRanks } = this.injectRankingAfterJudgment(
      body,
      sorted,
      snapshotByQuery,
      inventoryIndex
    );

    // インライン注入できなかった提案（見出し欠落・rank不一致）だけを末尾へ付記し、誤帰属なく情報を残す。
    const remaining = sorted.filter(proposal => !injectedRanks.has(proposal.rank));
    if (remaining.length === 0) {
      return injectedBody;
    }
    console.warn(
      '[GoogleAdsAiAnalysisService] ranking placed at bottom for unmatched proposals',
      { injected: injectedRanks.size, remaining: remaining.length }
    );
    const blocks = remaining.map(
      proposal =>
        `### 優先順位${proposal.rank}位 ${proposal.mainKw}\n\n${this.buildProposalRankingBlock(
          proposal,
          snapshotByQuery,
          inventoryIndex
        )}`
    );
    const headerLines = ['## 現状成績（検索順位・タイトル・URL）'];
    if (!hasSnapshot) {
      headerLines.push('※ 検索順位データがありません。');
    }
    return `${injectedBody}\n\n${[...headerLines, '', ...blocks].join('\n\n')}`;
  }

  /**
   * §17.4 Increment2: 本文中の各「▼ 新規作成 / 既存修正の判定 ▼」ブロックの直後
   * （＝判定ブロックの次に現れる見出し行の手前）へ、提案の順位ブロックを挿入する。
   * 提案の対応づけは出現順ではなく「優先順位N位」アンカーで行い、見出し欠落時の誤帰属を防ぐ。
   * rank が特定できない判定見出しには注入しない。注入できた rank の集合を返し、
   * 未注入の提案は呼び出し側が末尾へ付記する（ラベル付きで誤帰属しない）。
   */
  private injectRankingAfterJudgment(
    body: string,
    sorted: TopProposalKeyword[],
    snapshotByQuery: Map<string, RankingSnapshotItem>,
    inventoryIndex: InventoryIndex
  ): { body: string; injectedRanks: Set<number> } {
    // 判定見出し（太字・空白・スラッシュ有無のゆれを許容）
    const judgmentHeadingRe = /▼[^\n]*新規作成[^\n]*既存修正[^\n]*判定[^\n]*▼/;
    // 次セクションの見出し行（▼…▼ 見出し、または # 見出し）
    const sectionHeadingRe = /^\s*(?:#{1,6}\s|\*{0,2}▼)/;
    // 提案アンカー（例:「優先順位1位 …」）。この番号で提案を明示対応づける。
    const rankAnchorRe = /優先順位\s*(\d+)\s*位/;

    const byRank = new Map<number, TopProposalKeyword>();
    for (const proposal of sorted) {
      if (!byRank.has(proposal.rank)) {
        byRank.set(proposal.rank, proposal);
      }
    }

    const lines = body.split('\n');
    const out: string[] = [];
    const injectedRanks = new Set<number>();
    let currentRank: number | null = null;
    let awaitingRank: number | null = null; // 判定見出し後、注入待ちの提案 rank（不明なら null）

    const insertBlock = (): void => {
      if (awaitingRank !== null && !injectedRanks.has(awaitingRank)) {
        const proposal = byRank.get(awaitingRank);
        if (proposal) {
          // 前後を空行で挟み、直後の見出し（▼顕在ニーズ等）と段落が結合しないようにする。
          out.push(
            '',
            this.buildProposalRankingBlock(proposal, snapshotByQuery, inventoryIndex),
            ''
          );
          injectedRanks.add(awaitingRank);
        }
      }
      awaitingRank = null;
    };

    for (const line of lines) {
      // 判定ブロックの後、最初に現れた見出しの手前で順位ブロックを差し込む。
      if (awaitingRank !== null && sectionHeadingRe.test(line)) {
        insertBlock();
      }
      const rankMatch = line.match(rankAnchorRe);
      if (rankMatch?.[1]) {
        currentRank = Number(rankMatch[1]);
      }
      out.push(line);
      if (judgmentHeadingRe.test(line)) {
        // 現在の提案 rank をアンカーに注入予約（不明なら予約せず＝末尾送り）。
        awaitingRank = currentRank;
      }
    }
    // 判定ブロックが本文末尾だった場合の取りこぼし防止
    if (awaitingRank !== null) {
      insertBlock();
    }

    return { body: out.join('\n'), injectedRanks };
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
  { keywordId: '1007', keywordText: '壁掛けエアコン クリーニング', matchType: 'PHRASE', campaignName: 'エアコン洗浄_一般', adGroupName: '機種別', status: 'ENABLED', impressions: 8800, clicks: 700, ctr: 0.08, cpc: 360, cost: 252000, qualityScore: 8, conversions: 30, costPerConversion: 8400, searchImpressionShare: 0.62, conversionRate: 0.043 },
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
  { searchTerm: '壁掛けエアコン クリーニング 料金', campaignId: '2001', campaignName: 'エアコン洗浄_一般', adGroupId: '3005', adGroupName: '機種別', impressions: 3200, clicks: 256, cost: 92160, conversions: 14, conversionValue: 70000 },
  { searchTerm: 'エアコン 臭い 洗浄', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 640, clicks: 38, cost: 15960, conversions: 1, conversionValue: 5000 },
  { searchTerm: 'エアコンクリーニング プロ 頼む', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3006', adGroupName: 'プロ・専門業者', impressions: 520, clicks: 46, cost: 17250, conversions: 2, conversionValue: 10000 },
  { searchTerm: 'エアコン 丸洗い 費用', campaignId: '2002', campaignName: 'エアコン洗浄_プレミアム', adGroupId: '3004', adGroupName: '分解・内部洗浄', impressions: 410, clicks: 20, cost: 8000, conversions: 1, conversionValue: 5000 },
];

// §17 DEV 検証用サンプル。DEV_SAMPLE_KEYWORDS のエアコン系KWと正規化一致するよう設計し、
// メール順位表の3分岐（上位安定=維持 / 中位帯=修正 / 未マッチ=順位データなし）と
// content_annotation_id NULL の URL のみフォールバックを一通り確認できるようにしている。
// 新規/修正の両パターンを必ず発火させるため:
//   - 既存修正: エアコンクリーニング/料金/分解洗浄/業者おすすめ は在庫・順位ありで「修正」想定。
//   - 新規作成: 「壁掛けエアコン クリーニング」(機種別) を高実績KWに設定しつつ在庫・順位に一切登録しない。
//     検索意図が他トピックと重ならないため、AI は TOP5 に選びつつ「新規作成」＋「順位データなし」を出す。
const DEV_SAMPLE_CONTENT_INVENTORY: ContentInventoryItem[] = [
  { id: 'ci-top', title: 'エアコンクリーニングとは｜料金・作業の流れ・効果まとめ', url: 'https://sample-clean.jp/cleaning', mainKw: 'エアコンクリーニング', kw: 'エアコン 洗浄', categoryNames: ['サービス'], excerpt: 'エアコンクリーニングの基礎知識、料金、作業の流れ、効果をまとめて解説します…' },
  { id: 'ci-price', title: 'エアコンクリーニングの料金相場と内訳を徹底解説', url: 'https://sample-clean.jp/price', mainKw: 'エアコンクリーニング 料金', kw: 'エアコン 掃除 費用', categoryNames: ['料金'], excerpt: 'エアコンクリーニングの料金は機種や台数で変わります。本記事では相場と内訳を…' },
  { id: 'ci-disassembly', title: 'エアコンの分解洗浄とは？通常クリーニングとの違い', url: 'https://sample-clean.jp/disassembly', mainKw: 'エアコン 分解洗浄', kw: '内部洗浄 違い', categoryNames: ['サービス'], excerpt: '分解洗浄は内部部品を取り外して洗う方法です。通常清掃との違いを…' },
  { id: 'ci-choose', title: '失敗しないエアコンクリーニング業者の選び方', url: 'https://sample-clean.jp/choose', mainKw: 'エアコンクリーニング 業者 おすすめ', kw: '業者 選び方 比較', categoryNames: ['業者選び'], excerpt: '業者選びで確認すべき料金体系・実績・保証のポイントを整理します…' },
  { id: 'ci-diy', title: 'エアコン掃除を自分でやる方法と業者依頼の判断基準', url: 'https://sample-clean.jp/diy-or-pro', mainKw: 'エアコン 掃除 自分で', kw: 'DIY 業者 比較', categoryNames: ['お役立ち'], excerpt: '自分で掃除できる範囲と業者に頼むべきケースを整理します…' },
  // GSC順位スナップショットには無いが在庫にある記事（在庫フォールバック確認用）。
  // 提案1のサブKW「エアコンクリーニング 一台」に一致し、「既存記事あり（検索順位データなし）」を出す。
  { id: 'ci-onesize', title: 'エアコンクリーニング1台あたりの料金と追加費用の目安', url: 'https://sample-clean.jp/one-unit-price', mainKw: 'エアコンクリーニング 一台', kw: '一台 いくら', categoryNames: ['料金'], excerpt: '1台あたりの基本料金と、台数・機種による追加費用の目安を解説します…' },
];

const DEV_SAMPLE_RANKING_SNAPSHOT: RankingSnapshotItem[] = [
  // 上位安定（1〜3位）→ AI は「現状維持寄り」を出す想定
  { queryNormalized: 'エアコンクリーニング', position: 2, impressions: 5400, clicks: 540, url: 'https://sample-clean.jp/cleaning', title: 'エアコンクリーニングとは｜料金・作業の流れ・効果まとめ', contentAnnotationId: 'ci-top' },
  // 中位帯（4〜30位）→ AI は「既存修正（上昇余地大）」を出す想定
  { queryNormalized: 'エアコンクリーニング 料金', position: 8, impressions: 1200, clicks: 96, url: 'https://sample-clean.jp/price', title: 'エアコンクリーニングの料金相場と内訳を徹底解説', contentAnnotationId: 'ci-price' },
  { queryNormalized: 'エアコン 分解洗浄', position: 18, impressions: 540, clicks: 12, url: 'https://sample-clean.jp/disassembly', title: 'エアコンの分解洗浄とは？通常クリーニングとの違い', contentAnnotationId: 'ci-disassembly' },
  { queryNormalized: 'エアコンクリーニング 業者 おすすめ', position: 26, impressions: 420, clicks: 9, url: 'https://sample-clean.jp/choose', title: '失敗しないエアコンクリーニング業者の選び方', contentAnnotationId: 'ci-choose' },
  // content_annotation_id NULL（WP未取込）→ タイトル空・URL のみのフォールバック確認
  { queryNormalized: 'エアコン 掃除 業者', position: 42, impressions: 380, clicks: 6, url: 'https://sample-clean.jp/legacy-cleaning-guide', title: '', contentAnnotationId: null },
  // ※「エアコン内部クリーニング」「エアコン 洗浄 プロ」等は意図的に未登録 → 順位データなし（新規候補）
];
