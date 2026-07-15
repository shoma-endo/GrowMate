import { stripHtml } from '@/lib/utils';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  buildWordPressServiceFromSettings,
  WPCOM_TOKEN_COOKIE_NAME,
} from '@/server/services/wordpressContext';
import { WordPressService } from '@/server/services/wordpressService';

export interface WpPostContentFields {
  contentText: string | null;
  contentHtml: string | null;
  title: string | null;
  excerpt: string | null;
}

type CookieGetter = (name: string) => string | undefined;

interface WpPostSource {
  title?: unknown;
  content?: unknown;
  excerpt?: unknown;
}

function resolveRendered(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object' && typeof (raw as { rendered?: unknown }).rendered === 'string') {
    return (raw as { rendered: string }).rendered;
  }
  return null;
}

function extractPostFields(post: WpPostSource): WpPostContentFields {
  const contentHtml = resolveRendered(post.content) ?? '';
  const titleHtml = resolveRendered(post.title) ?? '';
  const excerptHtml = resolveRendered(post.excerpt) ?? '';

  return {
    contentHtml: contentHtml || null,
    contentText: stripHtml(contentHtml).trim() || null,
    title: stripHtml(titleHtml).trim() || null,
    excerpt: stripHtml(excerptHtml).trim() || null,
  };
}

function extractDirectPostId(url: URL): number | null {
  const paramNames = ['post', 'p', 'page_id'];
  for (const name of paramNames) {
    const value = url.searchParams.get(name);
    if (value && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

function buildSlugCandidates(url: URL): string[] {
  const segments = url.pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));
  if (!segments.length) {
    return [];
  }

  const lastSegmentRaw = segments[segments.length - 1];
  if (!lastSegmentRaw) {
    return [];
  }

  const withoutSuffix = lastSegmentRaw.replace(/\.(html?|php)$/i, '');
  const candidates = new Set<string>();
  if (withoutSuffix) {
    candidates.add(withoutSuffix);
    candidates.add(withoutSuffix.toLowerCase());
  }
  if (lastSegmentRaw && lastSegmentRaw !== withoutSuffix) {
    candidates.add(lastSegmentRaw);
    candidates.add(lastSegmentRaw.toLowerCase());
  }
  return Array.from(candidates);
}

async function resolveWpPostIdFromCanonical(
  canonicalUrl: string,
  wpService: WordPressService
): Promise<number | null> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(canonicalUrl.trim());
  } catch {
    return null;
  }

  const directId = extractDirectPostId(targetUrl);
  if (directId !== null) {
    return directId;
  }

  const slugCandidates = buildSlugCandidates(targetUrl);
  if (!slugCandidates.length) {
    return null;
  }

  for (const type of ['posts', 'pages'] as const) {
    for (const slug of slugCandidates) {
      const result = await wpService.findExistingContent(slug, type);
      if (result.success && result.data) {
        const postId = result.data.id;
        if (typeof postId === 'number' && Number.isSafeInteger(postId) && postId > 0) {
          return postId;
        }
      }
    }
  }

  return null;
}

async function refreshWpComAccessToken(
  userId: string,
  supabase: SupabaseService,
  wpSettings: NonNullable<Awaited<ReturnType<SupabaseService['getWordPressSettingsByUserId']>>>
): Promise<string | null> {
  let accessToken = wpSettings.wpAccessToken ?? null;
  const expiresAt = wpSettings.wpTokenExpiresAt
    ? new Date(wpSettings.wpTokenExpiresAt).getTime()
    : null;

  if (accessToken && expiresAt && expiresAt - Date.now() < 60 * 1000) {
    const refreshed = await supabase.refreshWpComToken(userId, wpSettings);
    if (refreshed.success) {
      accessToken = refreshed.accessToken;
      wpSettings.wpAccessToken = refreshed.accessToken ?? null;
      wpSettings.wpRefreshToken = refreshed.refreshToken ?? wpSettings.wpRefreshToken ?? null;
      wpSettings.wpTokenExpiresAt = refreshed.expiresAt ?? wpSettings.wpTokenExpiresAt ?? null;
    } else {
      accessToken = null;
    }
  }

  return accessToken;
}

async function fetchPostById(
  wpPostId: number,
  userId: string,
  getCookie: CookieGetter
): Promise<WpPostContentFields | null> {
  const supabase = new SupabaseService();
  const wpSettings = await supabase.getWordPressSettingsByUserId(userId);
  if (!wpSettings) {
    return null;
  }

  if (wpSettings.wpType === 'self_hosted') {
    const ctx = buildWordPressServiceFromSettings(wpSettings, () => undefined);
    if (!ctx.success) {
      return null;
    }
    const post = await ctx.service.resolveContentById(wpPostId);
    if (!post.success || !post.data) {
      return null;
    }
    return extractPostFields(post.data);
  }

  const cookieAccessToken = getCookie(WPCOM_TOKEN_COOKIE_NAME);
  const accessToken =
    cookieAccessToken || (await refreshWpComAccessToken(userId, supabase, wpSettings));
  if (!accessToken) {
    return null;
  }

  const ctx = buildWordPressServiceFromSettings(wpSettings, name =>
    name === WPCOM_TOKEN_COOKIE_NAME ? accessToken : undefined
  );
  if (!ctx.success) {
    return null;
  }

  const post = await ctx.service.resolveContentById(wpPostId);
  if (!post.success || !post.data) {
    return null;
  }

  return extractPostFields(post.data);
}

async function updateContentCache(
  supabase: SupabaseService,
  userId: string,
  wpPostId: number,
  fields: WpPostContentFields
): Promise<void> {
  if (!fields.contentText && !fields.excerpt && !fields.title) {
    return;
  }

  await supabase
    .getClient()
    .from('content_annotations')
    .update({
      wp_content_text: fields.contentText,
      wp_excerpt: fields.excerpt ?? null,
      ...(fields.title ? { wp_post_title: fields.title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('wp_post_id', wpPostId);
}

export async function fetchWpPostContentWithCache(params: {
  wpPostId: number | null;
  cachedContent: string | null;
  cachedExcerpt: string | null;
  userId: string;
}): Promise<Omit<WpPostContentFields, 'contentHtml'> | null> {
  const { wpPostId, cachedContent, cachedExcerpt, userId } = params;
  const needsFetch =
    !cachedContent ||
    cachedContent.trim().length === 0 ||
    !cachedExcerpt ||
    cachedExcerpt.trim().length === 0;

  if (!wpPostId) {
    return needsFetch ? null : { contentText: cachedContent, title: null, excerpt: cachedExcerpt };
  }

  if (!needsFetch) {
    return { contentText: cachedContent, title: null, excerpt: cachedExcerpt };
  }

  try {
    const fields = await fetchPostById(wpPostId, userId, () => undefined);
    if (!fields) {
      return null;
    }

    await updateContentCache(new SupabaseService(), userId, wpPostId, fields);
    return {
      contentText: fields.contentText,
      title: fields.title,
      excerpt: fields.excerpt,
    };
  } catch (error) {
    console.error('[WordPressContentSync] fetchWpPostContentWithCache error', error);
    return null;
  }
}

export async function fetchWpPostContentLive(params: {
  userId: string;
  wpPostId: number | null;
  canonicalUrl: string | null;
  getCookie: CookieGetter;
}): Promise<WpPostContentFields | null> {
  const { userId, wpPostId, canonicalUrl, getCookie } = params;

  try {
    let resolvedPostId = wpPostId;

    if (!resolvedPostId && canonicalUrl?.trim()) {
      const supabase = new SupabaseService();
      const wpSettings = await supabase.getWordPressSettingsByUserId(userId);
      if (!wpSettings) {
        return null;
      }
      const ctx = buildWordPressServiceFromSettings(wpSettings, getCookie);
      if (!ctx.success) {
        return null;
      }
      resolvedPostId = await resolveWpPostIdFromCanonical(canonicalUrl, ctx.service);
    }

    if (!resolvedPostId) {
      return null;
    }

    const fields = await fetchPostById(resolvedPostId, userId, getCookie);
    if (!fields) {
      return null;
    }

    await updateContentCache(new SupabaseService(), userId, resolvedPostId, fields);
    return fields;
  } catch (error) {
    console.error('[WordPressContentSync] fetchWpPostContentLive error', error);
    return null;
  }
}
