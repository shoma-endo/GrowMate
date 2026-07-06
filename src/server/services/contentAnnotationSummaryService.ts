import {
  CONTENT_ANNOTATION_SUMMARY_MAX_CONTENT_CHARS,
  MODEL_CONFIGS,
} from '@/lib/constants';
import { extractBasicStructureFromHtml } from '@/lib/html-content-extractor';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { PromptService } from '@/server/services/promptService';
import { llmChat } from '@/server/services/llmService';
import { SupabaseService } from '@/server/services/supabaseService';
import { fetchWpPostContentLive } from '@/server/services/wordpressContentSync';
import {
  contentAnnotationAiSummarySchema,
  type ContentAnnotationAiSummaryFields,
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

type SummaryErrorCode =
  | 'SUMMARY_SOURCE_NOT_LINKED'
  | 'SUMMARY_CONTENT_FETCH_FAILED'
  | 'SUMMARY_CONTENT_TOO_LARGE'
  | 'SUMMARY_AI_FAILED'
  | 'SUMMARY_PARSE_FAILED'
  | 'ACCESS_DENIED'
  | 'ANNOTATION_NOT_FOUND';

type GenerateSummaryResult =
  | { success: true; fields: ContentAnnotationSummaryFields }
  | { success: false; code: SummaryErrorCode };

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
    case 'SUMMARY_PARSE_FAILED':
      return ERROR_MESSAGES.WORDPRESS.SUMMARY_PARSE_FAILED;
    case 'ACCESS_DENIED':
      return 'アクセス権の確認に失敗しました';
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
    sessionId: string;
    executorUserId: string;
    cookieStore: ReadonlyRequestCookies;
  }): Promise<GenerateSummaryResult> {
    const client = this.supabase.getClient();
    const { sessionId, executorUserId, cookieStore } = params;

    const { data: accessibleIds, error: accessError } = await client.rpc('get_accessible_user_ids', {
      p_user_id: executorUserId,
    });

    if (accessError || !accessibleIds) {
      return { success: false, code: 'ACCESS_DENIED' };
    }

    const { data: sessionData, error: sessionError } = await client
      .from('chat_sessions')
      .select('user_id')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError || !sessionData?.user_id) {
      return { success: false, code: 'ANNOTATION_NOT_FOUND' };
    }

    const sessionOwnerId = sessionData.user_id;
    if (!accessibleIds.includes(sessionOwnerId)) {
      return { success: false, code: 'ACCESS_DENIED' };
    }

    const { data: annotation, error: annotationError } = await client
      .from('content_annotations')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', sessionOwnerId)
      .maybeSingle();

    if (annotationError || !annotation) {
      return { success: false, code: 'ANNOTATION_NOT_FOUND' };
    }

    const typedAnnotation = annotation as AnnotationRecord;
    if (!isWordPressLinked(typedAnnotation)) {
      return { success: false, code: 'SUMMARY_SOURCE_NOT_LINKED' };
    }

    const wpContent = await fetchWpPostContentLive({
      userId: sessionOwnerId,
      wpPostId: typedAnnotation.wp_post_id ?? null,
      canonicalUrl: typedAnnotation.canonical_url ?? null,
      getCookie: name => cookieStore.get(name)?.value,
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
          timeoutMs: 180000,
        }
      );
    } catch (error) {
      console.error('[ContentAnnotationSummary] LLM call failed:', error);
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
        opening_proposal: parsedFields.opening_proposal.trim() || null,
        basic_structure: basicStructure || null,
        impressions: typedAnnotation.impressions ?? null,
      },
    };
  }
}

export const contentAnnotationSummaryService = new ContentAnnotationSummaryService();
