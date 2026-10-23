'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { wordpressBulkPublishInputSchema, wordpressPublishDefaultsSchema, wordpressPublishInputSchema } from '@/server/schemas/wordpressPublish.schema';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { hasPaidFeatureAccess } from '@/types/user';
import { SupabaseService } from '@/server/services/supabaseService';
import { WordPressPublishService } from '@/server/services/wordpressPublishService';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { resolveWpComAccessToken } from '@/server/services/wordpressContentSync';
import { analyticsContentService } from '@/server/services/analyticsContentService';
import { asContentAnnotationPublishClient } from '@/types/database.types.pending';

const publishService = new WordPressPublishService();
const supabaseService = new SupabaseService();

async function authorizePublish() {
  const auth = await authMiddleware();
  const conflict = emailLinkConflictErrorPayload(auth);
  if (conflict) return { error: conflict } as const;
  if (auth.error || !auth.userId || !auth.userDetails || !hasPaidFeatureAccess(auth.userDetails.role)) {
    return { error: { success: false as const, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED } } as const;
  }
  return { userId: auth.userId } as const;
}

async function ownsPublishTarget(userId: string, annotationId?: string, sessionId?: string): Promise<boolean> {
  const client = asContentAnnotationPublishClient(supabaseService.getClient());
  if (annotationId) {
    const { data } = await client.from('content_annotations').select('id').eq('id', annotationId).eq('user_id', userId).maybeSingle();
    return Boolean(data);
  }
  if (!sessionId) return false;
  const { data } = await client.from('chat_sessions').select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

export async function getWordPressPublishDefaults(input: unknown) {
  const parsed = wordpressPublishDefaultsSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  const auth = await authorizePublish();
  if ('error' in auth) return auth.error;
  if (!(await ownsPublishTarget(auth.userId, parsed.data.annotationId, parsed.data.sessionId))) {
    return { success: false as const, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED };
  }
  const settings = await supabaseService.getWordPressSettingsByUserId(auth.userId);
  if (!settings) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_CONNECTED, recovery: 'setup' as const };
  const defaults = await publishService.getDefaults(auth.userId, parsed.data.annotationId, parsed.data.sessionId);
  if (!defaults) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NO_CONTENT, recovery: 'open_chat' as const };
  let status = defaults.status;
  let scheduledAt = defaults.scheduledAt;
  if (defaults.wpPostId) {
    if (settings.wpType === 'wordpress_com') {
      const token = await resolveWpComAccessToken(auth.userId, supabaseService, settings);
      if ('accessToken' in token) settings.wpAccessToken = token.accessToken;
    }
    const context = buildWordPressServiceFromSettings(settings, () => undefined);
    if (context.success) {
      try {
        const post = await context.service.fetchPost(defaults.contentType, defaults.wpPostId);
        if (post.status === 'future' || post.status === 'draft') status = post.status;
        if (post.status === 'future' && post.date_gmt) {
          scheduledAt = `${post.date_gmt.replace(/Z$/, '')}Z`;
        }
      } catch (error) {
        console.error('[wordpress-publish] Failed to fetch current post defaults', error);
      }
    }
  }
  return {
    success: true as const,
    data: {
      annotationId: defaults.annotationId,
      wpPostId: defaults.wpPostId,
      sessionId: defaults.sessionId,
      title: defaults.title,
      headingCount: defaults.headingCount,
      characterCount: defaults.characterCount,
      contentType: defaults.contentType,
      status,
      scheduledAt,
      storedStatus: defaults.storedStatus,
      categoryIds: defaults.categoryIds,
    },
  };
}

export async function getWordPressPublishCategories() {
  const auth = await authorizePublish();
  if ('error' in auth) return auth.error;
  const settings = await supabaseService.getWordPressSettingsByUserId(auth.userId);
  if (!settings) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_CONNECTED };
  if (settings.wpType === 'wordpress_com') {
    const token = await resolveWpComAccessToken(auth.userId, supabaseService, settings);
    if (!('accessToken' in token)) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_RELINK };
    settings.wpAccessToken = token.accessToken;
  }
  const result = buildWordPressServiceFromSettings(settings, () => undefined);
  if (!result.success) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_RELINK };
  try {
    const categories = await result.service.fetchCategories();
    return { success: true as const, data: categories };
  } catch (error) {
    console.error('[wordpress-publish] Failed to fetch categories', error);
    return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_CATEGORY_FETCH_FAILED };
  }
}

export async function publishToWordPress(input: unknown) {
  const parsed = wordpressPublishInputSchema.safeParse(input);
  if (!parsed.success) {
    console.error('[wordpress-publish] validation failed:', z.prettifyError(parsed.error));
    return { success: false as const, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED, recovery: 'close' as const };
  }
  if (parsed.data.status === 'future' && (!parsed.data.scheduledAt || new Date(parsed.data.scheduledAt).getTime() <= Date.now())) {
    return { success: false as const, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED, recovery: 'close' as const };
  }
  const auth = await authorizePublish();
  if ('error' in auth) return { ...auth.error, recovery: 'close' as const };
  if (!(await ownsPublishTarget(auth.userId, parsed.data.annotationId, parsed.data.sessionId))) {
    return { success: false as const, error: ERROR_MESSAGES.AUTH.UNAUTHORIZED, recovery: 'close' as const };
  }
  const settings = await supabaseService.getWordPressSettingsByUserId(auth.userId);
  if (!settings) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_CONNECTED, recovery: 'setup' as const };
  const cookieStore = await cookies();
  return publishService.publish(auth.userId, settings, name => cookieStore.get(name)?.value, {
    ...(parsed.data.annotationId ? { annotationId: parsed.data.annotationId } : {}),
    ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {}),
    title: parsed.data.title,
    contentType: parsed.data.contentType,
    status: parsed.data.status,
    ...(parsed.data.scheduledAt ? { scheduledAt: parsed.data.scheduledAt } : {}),
    ...(parsed.data.categoryIds ? { categoryIds: parsed.data.categoryIds } : {}),
    ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
  });
}

export async function publishWordPressDraftsBulk(input: unknown) {
  const parsed = wordpressBulkPublishInputSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  const auth = await authorizePublish();
  if ('error' in auth) return auth.error;
  const targetIds = parsed.data.mode === 'ids'
    ? [...new Set(parsed.data.contentAnnotationIds)]
    : (await analyticsContentService.resolveAllAnnotationIds(auth.userId, 1000))?.ids.filter(id => !(parsed.data.mode === 'all' && parsed.data.excludedIds?.includes(id))) ?? [];
  const client = asContentAnnotationPublishClient(supabaseService.getClient());
  const { data: rows } = await client.from('content_annotations').select('*').eq('user_id', auth.userId).in('id', targetIds);
  const settings = await supabaseService.getWordPressSettingsByUserId(auth.userId);
  if (!settings) return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_CONNECTED };
  const startedAt = Date.now();
  const successes: string[] = [];
  const skipped: Array<{ annotationId: string; reason: string }> = [];
  let failure: { annotationId: string; message: string } | null = null;
  let processedCount = 0;
  for (const [index, row] of (rows ?? []).entries()) {
    if (Date.now() - startedAt >= 650_000) break;
    if (!row.session_id || row.wp_post_type === 'pages' || row.wp_post_status === 'future' || row.wp_post_status === 'publish' || (row.wp_post_id !== null && row.wp_post_status === null)) {
      skipped.push({ annotationId: row.id, reason: row.wp_post_status === 'future' ? ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_SCHEDULED : ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_OUT_OF_SCOPE });
      processedCount = index + 1;
      continue;
    }
    const defaults = await publishService.getDefaults(auth.userId, row.id, undefined);
    if (!defaults || !defaults.title.trim()) {
      skipped.push({ annotationId: row.id, reason: ERROR_MESSAGES.WORDPRESS.PUBLISH_BULK_SKIP_TITLE_EMPTY });
      processedCount = index + 1;
      continue;
    }
    const result = await publishService.publish(auth.userId, settings, () => undefined, {
      annotationId: row.id,
      title: defaults.title,
      contentType: 'posts',
      status: 'draft',
    });
    if (!result.success) {
      failure = { annotationId: row.id, message: result.error };
      processedCount = index + 1;
      break;
    }
    successes.push(row.id);
    processedCount = index + 1;
  }
  const remaining = (rows ?? []).slice(processedCount).map(row => row.id);
  return { success: true as const, data: { successes, skipped, failure, remaining } };
}
