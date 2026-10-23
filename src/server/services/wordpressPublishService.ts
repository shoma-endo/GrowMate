import 'server-only';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { extractHeadingTextFromLine } from '@/lib/heading-extractor';
import { markdownToWordPressHtml } from '@/lib/markdown-to-wordpress-html';
import { asContentAnnotationPublishClient, type ContentAnnotationPublishRow } from '@/types/database.types.pending';
import type { WordPressSettings } from '@/types/wordpress';
import { SupabaseService } from '@/server/services/supabaseService';
import { buildWordPressServiceFromSettings } from '@/server/services/wordpressContext';
import { resolveWpComAccessToken } from '@/server/services/wordpressContentSync';
import { WordPressRestFetchError, type WordPressService, type WordPressPublishPayload, type WordPressPublishPost } from '@/server/services/wordpressService';

export interface WordPressPublishInput {
  annotationId?: string;
  sessionId?: string;
  title: string;
  contentType: 'posts' | 'pages';
  status: 'draft' | 'future' | 'publish';
  scheduledAt?: string;
  categoryIds?: number[];
  slug?: string;
}

export interface WordPressPublishDefaults {
  annotationId: string | null;
  wpPostId: number | null;
  sessionId: string;
  content: string;
  title: string;
  headingCount: number;
  characterCount: number;
  contentType: 'posts' | 'pages';
  status: 'draft' | 'future' | 'publish';
  scheduledAt: string | null;
  storedStatus: 'draft' | 'future' | 'publish' | null;
  categoryIds: number[];
}

export type WordPressPublishOutcome =
  | { success: true; data: { outcome: 'sent' | 'already_published'; wpPostId: number; status: string; link: string } }
  | { success: false; error: string; recovery: 'setup' | 'relink' | 'retry' | 'close' | 'open_chat' | 'resend' };

type PublishRecovery = 'setup' | 'relink' | 'retry' | 'close' | 'open_chat' | 'resend';

function getWordPressPostTitle(post: WordPressPublishPost, fallbackTitle: string): string {
  return typeof post.title === 'string' ? post.title : post.title.rendered ?? fallbackTitle;
}

export class WordPressPublishService extends SupabaseService {
  async getDefaults(userId: string, annotationId: string | undefined, sessionId: string | undefined): Promise<WordPressPublishDefaults | null> {
    const client = asContentAnnotationPublishClient(this.getClient());
    const query = client.from('content_annotations').select('*').eq('user_id', userId);
    const { data: annotation } = annotationId
      ? await query.eq('id', annotationId).maybeSingle()
      : await query.eq('session_id', sessionId ?? '').maybeSingle();
    if (annotationId && !annotation) return null;
    const resolvedSessionId = annotationId ? annotation?.session_id : annotation?.session_id ?? sessionId;
    if (!resolvedSessionId) return null;
    const { data: contentRow } = await client.from('session_combined_contents').select('content').eq('session_id', resolvedSessionId).eq('is_latest', true).maybeSingle();
    if (!contentRow?.content) return null;
    const lines = contentRow.content.split('\n');
    const firstTitle = lines.find(line => line.startsWith('# '))?.slice(2).trim() || undefined;
    return {
      annotationId: annotation?.id ?? null,
      wpPostId: annotation?.wp_post_id ?? null,
      sessionId: resolvedSessionId,
      content: contentRow.content,
      title: firstTitle ?? annotation?.wp_post_title ?? '',
      headingCount: lines.filter(line => extractHeadingTextFromLine(line) !== null).length,
      characterCount: contentRow.content.length,
      contentType: annotation?.wp_post_type === 'pages' ? 'pages' : 'posts',
      status: annotation?.wp_post_status === 'future' ? 'future' : 'draft',
      scheduledAt: null,
      storedStatus: annotation?.wp_post_status ?? null,
      categoryIds: annotation?.wp_categories ?? [],
    };
  }

  async publish(userId: string, settings: WordPressSettings, getCookie: (name: string) => string | undefined, input: WordPressPublishInput): Promise<WordPressPublishOutcome> {
    const client = asContentAnnotationPublishClient(this.getClient());
    const failure = (error: string, recovery: PublishRecovery): WordPressPublishOutcome => ({ success: false, error, recovery });
    const defaults = await this.getDefaults(userId, input.annotationId, input.sessionId);
    if (!defaults) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_NO_CONTENT, 'open_chat');
    const { data: annotation } = await client.from('content_annotations').select('*').eq('user_id', userId).eq('session_id', defaults.sessionId).maybeSingle();
    let row = annotation;
    if (!row) {
      const { data: created, error } = await client.from('content_annotations').upsert({ user_id: userId, session_id: defaults.sessionId, main_kw: null }, { onConflict: 'session_id' }).select('*').single();
      if (error || !created) return failure(ERROR_MESSAGES.COMMON.SAVE_FAILED, 'close');
      row = created;
    }
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    let claim = await client.from('content_annotations').update({ wp_publish_claimed_at: new Date().toISOString() }).eq('id', row.id).eq('user_id', userId).is('wp_post_id', null).is('wp_publish_claimed_at', null).select('id').maybeSingle();
    if (!claim.data) claim = await client.from('content_annotations').update({ wp_publish_claimed_at: new Date().toISOString() }).eq('id', row.id).eq('user_id', userId).is('wp_post_id', null).lt('wp_publish_claimed_at', cutoff).select('id').maybeSingle();
    const creating = row.wp_post_id === null;
    if (!creating && (defaults.storedStatus === null || defaults.storedStatus === 'publish')) {
      return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_ALREADY_PUBLISHED, 'close');
    }
    if (creating && !claim.data) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_IN_PROGRESS, 'close');
    const releaseClaim = async () => {
      if (creating) await client.from('content_annotations').update({ wp_publish_claimed_at: null }).eq('id', row.id).eq('user_id', userId);
    };
    let service: WordPressService | null = null;
    if (settings.wpType === 'wordpress_com') {
      const token = await resolveWpComAccessToken(userId, this, settings).catch(error => {
        console.error('[wordpress-publish] Failed to resolve WordPress.com token', error);
        return { failure: 'temporary_failure' as const };
      });
      if (!('accessToken' in token)) {
        await releaseClaim();
        return failure(token.failure === 'temporary_failure' ? ERROR_MESSAGES.WORDPRESS.PUBLISH_UPDATE_FAILED : ERROR_MESSAGES.WORDPRESS.PUBLISH_RELINK, token.failure === 'temporary_failure' ? 'retry' : 'relink');
      }
      settings.wpAccessToken = token.accessToken;
      const result = buildWordPressServiceFromSettings(settings, () => undefined);
      if (result.success) service = result.service;
    } else {
      const result = buildWordPressServiceFromSettings(settings, getCookie);
      if (result.success) service = result.service;
    }
    if (!service) {
      await releaseClaim();
      return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_RELINK, 'relink');
    }
    let categories: Array<{ id: number; name: string }> = [];
    if (input.contentType === 'posts' && (input.categoryIds?.length ?? 0) > 0) {
      try {
        categories = (await service.fetchCategories()).categories;
      } catch (error) {
        console.error('[wordpress-publish] Failed to fetch categories', error);
        await releaseClaim();
        return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_CATEGORY_FETCH_FAILED, 'retry');
      }
    }
    const selectedCategories = categories.filter(category => input.categoryIds?.includes(category.id));
    const payload: WordPressPublishPayload = {
      title: input.title,
      content: markdownToWordPressHtml(defaults.content),
      status: input.status,
      ...(input.status === 'future' && input.scheduledAt ? { date_gmt: input.scheduledAt } : {}),
      ...(input.contentType === 'posts' && selectedCategories.length ? { categories: selectedCategories.map(category => category.id) } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
    };
    const type = creating ? input.contentType : row.wp_post_type === 'pages' ? 'pages' : 'posts';
    try {
      if (!creating) {
        const current = await service.fetchPost(type, row.wp_post_id ?? 0);
        if (current.status === 'publish') {
          const { error } = await client.from('content_annotations').update({ wp_post_title: getWordPressPostTitle(current, input.title), wp_post_status: 'publish', canonical_url: current.link }).eq('id', row.id).eq('user_id', userId);
          if (error) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_DB_SYNC_FAILED, 'close');
          return { success: true, data: { outcome: 'already_published', wpPostId: current.id, status: 'publish', link: current.link } };
        }
      }
      const post = creating
        ? await service.createPost(type, payload)
        : await service.updatePost(type, row.wp_post_id ?? 0, payload);
      if (!['draft', 'future', 'publish'].includes(post.status)) {
        return failure(creating ? ERROR_MESSAGES.WORDPRESS.PUBLISH_CREATE_UNCERTAIN : ERROR_MESSAGES.WORDPRESS.PUBLISH_UPDATE_FAILED, creating ? 'close' : 'retry');
      }
      const { error } = await client.from('content_annotations').update({ wp_post_id: post.id, wp_post_title: getWordPressPostTitle(post, input.title), wp_post_type: type, wp_post_status: post.status as 'draft' | 'future' | 'publish', canonical_url: post.status === 'publish' ? post.link : null, ...(type === 'posts' ? { wp_categories: selectedCategories.map(category => category.id), wp_category_names: selectedCategories.map(category => category.name) } : {}), wp_publish_claimed_at: null }).eq('id', row.id).eq('user_id', userId);
      if (error) {
        console.error('[wordpress-publish] DB sync failed', { annotationId: row.id, wpPostId: post.id });
        return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_DB_SYNC_FAILED, 'close');
      }
      return { success: true, data: { outcome: 'sent', wpPostId: post.id, status: post.status, link: post.link } };
    } catch (error) {
      console.error('[wordpress-publish] WordPress request failed', error);
      if (error instanceof WordPressRestFetchError) {
        if (!creating && error.code === 'rest_post_invalid_id') {
          await client.from('content_annotations').update({ wp_post_id: null, wp_post_title: null, wp_post_status: null }).eq('id', row.id).eq('user_id', userId);
          return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_DELETED(type), 'resend');
        }
        if (error.status === 401) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_RELINK, 'relink');
        if (error.status === 403) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_FORBIDDEN, 'close');
        if (error.status === 404) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_NOT_FOUND, 'retry');
        if (error.status >= 400 && error.status < 500) return failure(ERROR_MESSAGES.WORDPRESS.PUBLISH_REJECTED(error.message), 'close');
      }
      return failure(creating ? ERROR_MESSAGES.WORDPRESS.PUBLISH_CREATE_UNCERTAIN : ERROR_MESSAGES.WORDPRESS.PUBLISH_UPDATE_FAILED, creating ? 'close' : 'retry');
    } finally {
      if (creating) await client.from('content_annotations').update({ wp_publish_claimed_at: null }).eq('id', row.id).eq('user_id', userId);
    }
  }
}
