import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { htmlToMarkdownForCanvas, sanitizeHtmlForCanvas } from '@/lib/canvas-content';
import type { AnnotationRecord } from '@/types/annotation';
import type { WordPressPostResponse } from '@/types/wordpress';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { STEP7_ID, toBlogModel } from '@/lib/constants';

interface LoadWordPressRequestBody {
  sessionId?: string;
}

const extractSlugFromCanonical = (canonical: string): string | null => {
  try {
    const url = new URL(canonical);
    const segments = url.pathname
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      return null;
    }
    const lastSegment = segments[segments.length - 1]!;
    const withoutExtension = lastSegment.replace(/\.(html?|php)$/i, '');
    return decodeURIComponent(withoutExtension);
  } catch {
    return null;
  }
};

const resolveRenderedField = (
  field: { rendered?: string; raw?: string } | string | undefined
): string => {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field.rendered === 'string') return field.rendered;
  if (typeof field.raw === 'string') return field.raw;
  return '';
};

const extractHtmlFromPost = (post: WordPressPostResponse | null): string => {
  if (!post) return '';
  const content = resolveRenderedField(post.content);
  if (content.trim().length > 0) {
    return content;
  }
  const excerpt = resolveRenderedField(post.excerpt);
  return excerpt;
};

const jsonResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function POST(request: NextRequest) {
  try {
    const body: LoadWordPressRequestBody = await request.json();
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

    if (!sessionId) {
      return jsonResponse(400, {
        success: false,
        error: 'セッションIDが指定されていません',
      });
    }

    const authResult = await authMiddleware();
    const linkConflict = emailLinkConflictErrorPayload(authResult);
    if (linkConflict) {
      return jsonResponse(409, linkConflict);
    }
    if (authResult.error || !authResult.userId) {
      return jsonResponse(401, {
        success: false,
        error: authResult.error || 'ユーザー認証に失敗しました',
      });
    }

    const userId = authResult.userId;
    const supabaseService = new SupabaseService();
    const supabaseClient = supabaseService.getClient();

    const { data: annotation, error: annotationError } = await supabaseClient
      .from('content_annotations')
      .select('canonical_url, wp_post_id, wp_post_title')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (annotationError) {
      console.error('Failed to load content annotation:', annotationError);
      return jsonResponse(500, {
        success: false,
        error: 'コンテンツ情報の取得に失敗しました',
      });
    }

    const annotationData = (annotation ?? null) as AnnotationRecord | null;
    const canonicalUrl = annotationData?.canonical_url?.trim() ?? '';

    if (!annotationData || !canonicalUrl) {
      return jsonResponse(400, {
        success: false,
        error: 'このチャットにはブログ記事URLが登録されていません',
      });
    }

    const wpSettings = await supabaseService.getWordPressSettingsByUserId(userId);
    if (!wpSettings) {
      return jsonResponse(400, {
        success: false,
        error: 'WordPress設定が登録されていません',
      });
    }

    const buildResult = buildWordPressServiceFromSettings(
      wpSettings,
      name => request.cookies.get(name)?.value
    );

    if (!buildResult.success) {
      return jsonResponse(buildResult.reason === 'wordpress_auth_missing' ? 401 : 400, {
        success: false,
        error: buildResult.message,
        needsWordPressAuth: buildResult.needsWordPressAuth ?? false,
      });
    }

    const wpService = buildResult.service;
    let resolvedPost: WordPressPostResponse | null = null;

    if (typeof annotationData.wp_post_id === 'number') {
      const resolved = await wpService.resolveContentById(annotationData.wp_post_id);
      if (!resolved.success) {
        console.warn('Failed to resolve WordPress content by ID:', resolved.error);
      } else {
        resolvedPost = resolved.data ?? null;
      }
    }

    if (!resolvedPost) {
      const slug = extractSlugFromCanonical(canonicalUrl);
      if (!slug) {
        return jsonResponse(404, {
          success: false,
          error: 'ブログ記事URLからスラッグを判別できませんでした',
        });
      }

      const byPost = await wpService.findExistingContent(slug, 'posts');
      if (!byPost.success) {
        console.warn('Failed to find WordPress post by slug:', byPost.error);
      } else {
        resolvedPost = byPost.data ?? null;
      }

      if (!resolvedPost) {
        const byPage = await wpService.findExistingContent(slug, 'pages');
        if (!byPage.success) {
          console.warn('Failed to find WordPress page by slug:', byPage.error);
        } else {
          resolvedPost = byPage.data ?? null;
        }
      }
    }

    if (!resolvedPost) {
      return jsonResponse(404, {
        success: false,
        error: 'WordPressで該当する記事が見つかりませんでした',
      });
    }

    const html = extractHtmlFromPost(resolvedPost);
    if (!html || !html.trim()) {
      return jsonResponse(422, {
        success: false,
        error: 'WordPress記事から本文を取得できませんでした',
      });
    }

    const sanitizedHtml = sanitizeHtmlForCanvas(html);
    const markdown = htmlToMarkdownForCanvas(sanitizedHtml);
    if (!markdown || !markdown.trim()) {
      return jsonResponse(422, {
        success: false,
        error: 'WordPress記事の本文をMarkdownへ変換できませんでした',
      });
    }

    const assistantContent = markdown.trim();

    const nowIso = new Date().toISOString();
    const updateSessionResult = await supabaseService.updateChatSession(sessionId, userId, {
      last_message_at: nowIso,
    });

    if (!updateSessionResult.success) {
      return jsonResponse(500, {
        success: false,
        error:
          updateSessionResult.error.userMessage ||
          updateSessionResult.error.developerMessage ||
          'WordPress記事取得メッセージの記録に失敗しました',
      });
    }

    const assistantDbMessage = {
      id: randomUUID(),
      user_id: userId,
      session_id: sessionId,
      role: 'assistant' as const,
      content: assistantContent,
      model: toBlogModel(STEP7_ID),
      created_at: nowIso,
    };

    const createAssistantResult = await supabaseService.createChatMessage(assistantDbMessage);
    if (!createAssistantResult.success) {
      return jsonResponse(500, {
        success: false,
        error:
          createAssistantResult.error.userMessage ||
          createAssistantResult.error.developerMessage ||
          'WordPress記事取得メッセージの記録に失敗しました',
      });
    }

    return jsonResponse(200, {
      success: true,
      markdown: assistantContent,
    });
  } catch (error) {
    console.error('[Canvas WordPress Load] Unexpected error:', error);
    return jsonResponse(500, {
      success: false,
      error: 'WordPress記事の取得中にエラーが発生しました',
    });
  }
}
