import {
  CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS,
  CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS,
  MODEL_CONFIGS,
} from '@/lib/constants';
import {
  extractBasicStructureFromHtml,
  extractOpeningProposalFromHtml,
} from '@/lib/html-content-extractor';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { PromptService } from '@/server/services/promptService';
import { llmChat } from '@/server/services/llmService';
import { SupabaseService } from '@/server/services/supabaseService';
import { fetchWpPostContentLive } from '@/server/services/wordpressContentSync';
import {
  contentAnnotationAiSummarySchema,
  type ContentAnnotationAiSummaryFields,
  type SummarizeContentAnnotationTarget,
} from '@/server/schemas/contentAnnotationSummary.schema';
import type { AnnotationRecord } from '@/types/annotation';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)\s*```/i;

interface ContentAnnotationSummaryFields {
  main_kw: string | null;
  kw: string | null;
  needs: string | null;
  persona: string | null;
  goal: string | null;
  prep: string | null;
  opening_proposal: string | null;
  basic_structure: string | null;
  impressions: string | null;
}

export type SummaryErrorCode =
  | 'SUMMARY_SOURCE_NOT_LINKED'
  | 'SUMMARY_CONTENT_FETCH_FAILED'
  | 'SUMMARY_CONTENT_TOO_LARGE'
  | 'SUMMARY_AI_FAILED'
  /**
   * Anthropic のレート制限（429）。`SUMMARY_AI_FAILED` に寄せると内訳を出しても
   * 「AI の呼び出しに失敗」としか読めず、利用者にも運用にもレート制限だと分からない。
   * 次アクションが「時間をおいて再実行」で確定するので独立させる。
   */
  | 'SUMMARY_AI_RATE_LIMITED'
  | 'SUMMARY_PARSE_FAILED'
  | 'ANNOTATION_NOT_FOUND';

export type GenerateSummaryResult =
  | {
      success: true;
      fields: ContentAnnotationSummaryFields;
      annotationId: string;
      userId: string;
    }
  | { success: false; code: SummaryErrorCode };

type SaveSummaryResult =
  | { success: true; data: AnnotationRecord }
  | { success: false };

function mapSummaryError(code: SummaryErrorCode): string {
  switch (code) {
    case 'SUMMARY_SOURCE_NOT_LINKED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_SOURCE_NOT_LINKED;
    case 'SUMMARY_CONTENT_FETCH_FAILED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_CONTENT_FETCH_FAILED;
    case 'SUMMARY_CONTENT_TOO_LARGE':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_CONTENT_TOO_LARGE;
    case 'SUMMARY_AI_FAILED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_AI_FAILED;
    case 'SUMMARY_AI_RATE_LIMITED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_AI_RATE_LIMITED;
    case 'SUMMARY_PARSE_FAILED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_PARSE_FAILED;
    case 'ANNOTATION_NOT_FOUND':
      return 'コンテンツ情報が見つかりません';
    default:
      return ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR;
  }
}

export function getContentAnnotationSummaryErrorMessage(code: SummaryErrorCode): string {
  return mapSummaryError(code);
}

function extractJsonBlock(markdown: string): ContentAnnotationAiSummaryFields | null {
  const match = markdown.match(JSON_BLOCK_REGEX);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    const result = contentAnnotationAiSummarySchema.safeParse(parsed);
    if (!result.success) {
      console.error('[ContentAnnotationSummary] JSON schema validation failed');
      return null;
    }
    return result.data;
  } catch (error) {
    console.error('[ContentAnnotationSummary] JSON parse failed:', error);
    return null;
  }
}

function isWordPressLinked(annotation: AnnotationRecord): boolean {
  const hasPostId = typeof annotation.wp_post_id === 'number' && annotation.wp_post_id > 0;
  const hasCanonical = Boolean(annotation.canonical_url?.trim());
  return hasPostId || hasCanonical;
}

class ContentAnnotationSummaryService {
  private supabase = new SupabaseService();

  async generateSummary(params: {
    target: SummarizeContentAnnotationTarget;
    executorUserId: string;
    /**
     * ブラウザの Cookie。**任意**（2026-09-04 バックグラウンド化）。
     * cron にはセッションが無いため未指定で呼ばれ、その場合は WordPress.com の
     * アクセストークンを DB 保存トークン経路だけで解決する。
     * cron 側で `cookies()` を呼んで空の cookieStore を渡すような場当たりはしない。
     */
    cookieStore?: ReadonlyRequestCookies | undefined;
    /**
     * LLM 呼び出しのタイムアウト（ミリ秒）。既定は単記事と同じ 180 秒。
     * 一括実行は残り時間から算出した値を渡して既定を切り下げる
     * （docs/plans/content-annotation-bulk-ai-summary-spec.md BR-03）。
     */
    llmTimeoutMs?: number;
  }): Promise<GenerateSummaryResult> {
    const client = this.supabase.getClient();
    const { target, executorUserId, cookieStore } = params;
    const llmTimeoutMs = params.llmTimeoutMs ?? CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS;

    const annotationQuery = client
      .from('content_annotations')
      .select('*')
      .eq('user_id', executorUserId);
    const { data: annotation, error: annotationError } =
      'annotationId' in target
        ? await annotationQuery.eq('id', target.annotationId).maybeSingle()
        : await annotationQuery.eq('session_id', target.sessionId).maybeSingle();

    if (annotationError || !annotation) {
      return { success: false, code: 'ANNOTATION_NOT_FOUND' };
    }

    const typedAnnotation = annotation as AnnotationRecord;
    if (!typedAnnotation.id || typedAnnotation.user_id !== executorUserId) {
      return { success: false, code: 'ANNOTATION_NOT_FOUND' };
    }
    if (!isWordPressLinked(typedAnnotation)) {
      return { success: false, code: 'SUMMARY_SOURCE_NOT_LINKED' };
    }

    const wpContent = await fetchWpPostContentLive({
      userId: typedAnnotation.user_id,
      wpPostId: typedAnnotation.wp_post_id ?? null,
      canonicalUrl: typedAnnotation.canonical_url ?? null,
      getCookie: cookieStore ? name => cookieStore.get(name)?.value : () => undefined,
    });

    if (!wpContent?.contentText) {
      return { success: false, code: 'SUMMARY_CONTENT_FETCH_FAILED' };
    }

    if (wpContent.contentText.length > CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS) {
      return { success: false, code: 'SUMMARY_CONTENT_TOO_LARGE' };
    }

    const basicStructure = wpContent.contentHtml
      ? extractBasicStructureFromHtml(wpContent.contentHtml)
      : '';
    const openingProposal = wpContent.contentHtml
      ? extractOpeningProposalFromHtml(wpContent.contentHtml)
      : '';

    const template = await PromptService.getTemplateByName('content_annotation_ai_summary');
    if (!template) {
      console.error('[ContentAnnotationSummary] Prompt template not found');
      return { success: false, code: 'SUMMARY_AI_FAILED' };
    }

    const wpPostTitle =
      typedAnnotation.wp_post_title?.trim() ||
      wpContent.title?.trim() ||
      '（タイトル不明）';

    const filledPrompt = PromptService.replaceVariables(template.content, {
      wpPostTitle,
      wpContentText: wpContent.contentText,
    });

    const modelConfig = MODEL_CONFIGS['content_annotation_ai_summary'];
    if (!modelConfig) {
      console.error('[ContentAnnotationSummary] MODEL_CONFIGS entry not found');
      return { success: false, code: 'SUMMARY_AI_FAILED' };
    }

    let llmResponse: string;
    try {
      llmResponse = await llmChat(
        modelConfig.provider,
        modelConfig.actualModel,
        [{ role: 'user', content: filledPrompt }],
        {
          maxTokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
          // **この1行が無いと `MODEL_CONFIGS` の `thinking` は params に載らない。**
          // 載らないとモデルによってはアダプティブ思考が既定で有効のまま動き、思考トークンが
          // 出力料金で課金される。出力自体は成立するのでテストでは落ちず、請求額でしか気づけない
          thinking: modelConfig.thinking,
          timeoutMs: llmTimeoutMs,
        }
      );
    } catch (error) {
      console.error('[ContentAnnotationSummary] LLM call failed:', error);
      // 429 だけを分けて返す（待機・再試行はしない）。判定は ChatError.fromApiError が
      // 済ませているので、ここで新しい判定機構を作らない
      if (error instanceof ChatError && error.code === ChatErrorCode.ANTHROPIC_RATE_LIMIT) {
        return { success: false, code: 'SUMMARY_AI_RATE_LIMITED' };
      }
      return { success: false, code: 'SUMMARY_AI_FAILED' };
    }

    const parsedFields = extractJsonBlock(llmResponse);
    if (!parsedFields) {
      return { success: false, code: 'SUMMARY_PARSE_FAILED' };
    }

    return {
      success: true,
      fields: {
        main_kw: parsedFields.main_kw.trim() || null,
        kw: parsedFields.kw.trim() || null,
        needs: parsedFields.needs.trim() || null,
        persona: parsedFields.persona.trim() || null,
        goal: parsedFields.goal.trim() || null,
        prep: parsedFields.prep.trim() || null,
        opening_proposal: openingProposal || null,
        basic_structure: basicStructure || null,
        impressions: typedAnnotation.impressions ?? null,
      },
      annotationId: typedAnnotation.id,
      userId: typedAnnotation.user_id,
    };
  }

  async saveSummary(params: {
    annotationId: string;
    userId: string;
    fields: ContentAnnotationSummaryFields;
  }): Promise<SaveSummaryResult> {
    const client = this.supabase.getClient();
    const { annotationId, userId, fields } = params;
    const { data, error } = await client
      .from('content_annotations')
      .update({
        main_kw: fields.main_kw,
        kw: fields.kw,
        needs: fields.needs,
        persona: fields.persona,
        goal: fields.goal,
        prep: fields.prep,
        basic_structure: fields.basic_structure,
        opening_proposal: fields.opening_proposal,
        updated_at: new Date().toISOString(),
      })
      .eq('id', annotationId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('[ContentAnnotationSummary] Failed to save summary:', error);
      return { success: false };
    }

    return { success: true, data: data as AnnotationRecord };
  }
}

export const contentAnnotationSummaryService = new ContentAnnotationSummaryService();
