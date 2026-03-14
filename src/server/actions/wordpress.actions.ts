'use server';

import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { withAuth } from '@/server/middleware/withAuth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { isAdmin as isAdminRole, isActualOwner as isActualOwnerHelper } from '@/authUtils';
import {
  WordPressSettings,
  WordPressRestPost,
  WordPressNormalizedPost,
  WordPressRestTerm,
  RestRequestConfig,
  FetchCandidatesResult,
  RssNormalizeResult,
  RssItem,
  NormalizedPostResponse,
  ResolveCanonicalParams,
  ExistingAnnotationData,
  SaveWordPressSettingsParams,
} from '@/types/wordpress';
import {
  buildWordPressServiceFromSettings,
  resolveWordPressContext,
} from '@/server/services/wordpressContext';
import {
  normalizeWordPressRestPosts,
  extractCategoryNames,
} from '@/server/services/wordpressService';
import { normalizeContentTypes } from '@/server/services/wordpressContentTypes';
import { stripHtml } from '@/lib/utils';
import type {
  AnnotationRecord,
  ContentAnnotationPayload,
  SessionAnnotationUpsertPayload,
} from '@/types/annotation';
import type { DbChatSession } from '@/types/chat';
import type { Database } from '@/types/database.types';
import { isViewModeEnabled, VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const supabaseService = new SupabaseService();

const DUPLICATE_CANONICAL_ERROR_MESSAGE = ERROR_MESSAGES.WORDPRESS.DUPLICATE_CANONICAL;
const DUPLICATE_CONSTRAINT_IDENTIFIERS = [
  'content_annotations_user_id_wp_post_id_key',
  'idx_content_annotations_user_canonical_unique',
];

function isDuplicateCanonicalConstraint(error: {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}): boolean {
  if (error.code !== '23505') {
    return false;
  }
  const payload = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return DUPLICATE_CONSTRAINT_IDENTIFIERS.some(identifier => payload.includes(identifier));
}

/**
 * WordPress設定を取得
 */
export async function getWordPressSettings(): Promise<WordPressSettings | null> {
  return withAuth(async ({ userId, ownerUserId, actorUserId }) => {
    // View Modeの場合は本来のユーザー（オーナー）を使用
    const realUserId = actorUserId || userId;
    const isRealOwner = !!actorUserId;

    if (!isRealOwner && ownerUserId) {
      return null;
    }
    return await supabaseService.getWordPressSettingsByUserId(realUserId);
  });
}

async function getRestRequestConfig(
  wpSettings: WordPressSettings,
  getCookie: (name: string) => string | undefined,
  page: number,
  perPage: number
): Promise<RestRequestConfig> {
  const buildResult = buildWordPressServiceFromSettings(wpSettings, getCookie);
  if (!buildResult.success) {
    return {
      headers: {},
      candidates: [],
      siteUrlClean: '',
      isSelfHosted: wpSettings.wpType === 'self_hosted',
      error: buildResult.message,
    };
  }

  const service = buildResult.service;
  const headers = service.getRestHeaders();

  if (service.getAuthType() === 'wordpress_com') {
    const baseUrl = service.getRestBaseUrl();
    const candidates = [
      `${baseUrl}/posts?_embed=true&per_page=${perPage}&page=${page}`,
      `${baseUrl}/posts?per_page=${perPage}&page=${page}`,
    ];
    return { headers, candidates, siteUrlClean: '', isSelfHosted: false };
  }

  const siteUrlRaw = service.getSelfHostedSiteUrl() || '';
  const siteUrlClean = siteUrlRaw.replace(/\/$/, '');
  const candidates = [
    `${siteUrlClean}/wp-json/wp/v2/posts?_embed=true&per_page=${perPage}&page=${page}`,
    `${siteUrlClean}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}`,
    `${siteUrlClean}/index.php?rest_route=/wp/v2/posts&_embed=true&per_page=${perPage}&page=${page}`,
    `${siteUrlClean}/index.php?rest_route=/wp/v2/posts&per_page=${perPage}&page=${page}`,
  ];
  return { headers, candidates, siteUrlClean, isSelfHosted: true };
}

async function tryFetchCandidates(
  candidates: string[],
  headers: Record<string, string>
): Promise<FetchCandidatesResult> {
  let resp: Response | null = null;
  let lastStatus = 0;
  let lastErrorText = '';
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers, cache: 'no-store' });
      if (r.ok) {
        resp = r;
        break;
      }
      lastStatus = r.status;
      lastErrorText = await r.text().catch(() => r.statusText);
      console.error('[WP posts] Fetch failed candidate', {
        url,
        status: r.status,
        txt: lastErrorText,
      });
    } catch (e) {
      lastErrorText = e instanceof Error ? e.message : 'Unknown fetch error';
      console.error('[WP posts] Fetch exception candidate', { url, error: lastErrorText });
    }
  }
  return { resp, lastStatus, lastErrorText };
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const extractDirectPostId = (url: URL): number | null => {
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
};

const buildSlugCandidates = (url: URL): string[] => {
  const segments = url.pathname
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));
  if (!segments.length) return [];

  const lastSegmentRaw = segments[segments.length - 1];
  if (!lastSegmentRaw) return [];

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
};

const normalizePostResponse = (data: unknown): NormalizedPostResponse => {
  if (!data || typeof data !== 'object') return { id: null };
  const record = data as Record<string, unknown>;
  const idValue = record.id ?? record.ID;
  const id =
    typeof idValue === 'number' && Number.isSafeInteger(idValue) ? (idValue as number) : null;
  const result: NormalizedPostResponse = { id };
  if (typeof record.link === 'string') {
    result.link = record.link as string;
  }
  const titleValue = record.title;
  if (typeof titleValue === 'string' && titleValue.trim().length > 0) {
    result.title = titleValue;
  } else if (
    titleValue &&
    typeof titleValue === 'object' &&
    typeof (titleValue as { rendered?: unknown }).rendered === 'string'
  ) {
    const rendered = (titleValue as { rendered?: string }).rendered?.trim() || '';
    if (rendered) {
      result.title = rendered;
    }
  }


  // カテゴリーIDを取得
  if (Array.isArray(record.categories)) {
    const categoryIds = record.categories
      .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
      .filter(id => id > 0);
    if (categoryIds.length > 0) {
      result.categories = categoryIds;
    }
  }


  // カテゴリー名を取得（_embedded['wp:term']から）
  const embedded = record._embedded as { 'wp:term'?: Array<Array<WordPressRestTerm>> } | undefined;
  if (embedded?.['wp:term'] && Array.isArray(embedded['wp:term'])) {
    const termsNested = embedded['wp:term'];
    const firstTaxonomy =
      Array.isArray(termsNested) && termsNested.length > 0 ? termsNested[0] : undefined;
    const categoryNames = extractCategoryNames(firstTaxonomy);
    if (categoryNames.length > 0) {
      result.categoryNames = categoryNames;
    }
  }

  return result;
};

type CanonicalResolutionResult =
  | {
      success: true;
      canonicalUrl: string | null;
      wpPostId: number | null;
      wpPostTitle: string | null;
      wpCategories?: number[] | null;
      wpCategoryNames?: string[] | null;
    }
  | { success: false; error: string };

async function resolveCanonicalAndWpPostId(
  params: ResolveCanonicalParams & {
    supabaseService: SupabaseService;
    cookieStore: CookieStore;
  }
): Promise<CanonicalResolutionResult> {
  const { canonicalUrl, supabaseService: supabaseServiceLocal, userId, cookieStore } = params;

  const trimmed = typeof canonicalUrl === 'string' ? canonicalUrl.trim() : '';
  if (!trimmed) {
    return { success: true as const, canonicalUrl: null, wpPostId: null, wpPostTitle: null };
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(trimmed);
  } catch {
    return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.INVALID_URL };
  }

  const canonicalCandidate = targetUrl.toString();

  const directId = extractDirectPostId(targetUrl);
  const slugCandidates = directId === null ? buildSlugCandidates(targetUrl) : [];

  const wpSettings = await supabaseServiceLocal.getWordPressSettingsByUserId(userId);
  if (!wpSettings) {
    if (directId !== null) {
      return {
        success: true as const,
        canonicalUrl: canonicalCandidate,
        wpPostId: directId,
        wpPostTitle: null,
      };
    }
    return {
      success: false as const,
      error: ERROR_MESSAGES.WORDPRESS.SETTINGS_NOT_REGISTERED_DETAIL,
    };
  }

  const buildResult = buildWordPressServiceFromSettings(
    wpSettings,
    name => cookieStore.get(name)?.value
  );
  if (!buildResult.success) {
    return { success: false as const, error: buildResult.message };
  }
  const wpService = buildResult.service;

  if (directId !== null) {
    const byId = await wpService.resolveContentById(directId);
    if (!byId.success) {
      return {
        success: false as const,
        error: byId.error || 'WordPress APIの呼び出しに失敗しました',
      };
    }
    if (!byId.data) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.WORDPRESS.POST_ID_NOT_FOUND,
      };
    }
    const normalized = normalizePostResponse(byId.data);
    return {
      success: true as const,
      canonicalUrl: normalized.link ?? canonicalCandidate,
      wpPostId: normalized.id ?? directId,
      wpPostTitle: normalized.title ?? null,
      wpCategories: normalized.categories ?? null,
      wpCategoryNames: normalized.categoryNames ?? null,
    };
  }

  if (!slugCandidates.length) {
    return {
      success: false as const,
      error: ERROR_MESSAGES.WORDPRESS.POST_ID_CANNOT_BE_RESOLVED,
    };
  }

  type ResolveResult =
    | ({ id: number } & Partial<{ link: string; title: string }>)
    | { error: string }
    | null;
  const resolveByType = async (type: 'posts' | 'pages'): Promise<ResolveResult> => {
    let lastError: string | undefined;
    for (const slug of slugCandidates) {
      const result = await wpService.findExistingContent(slug, type);
      if (!result.success) {
        lastError = result.error || 'WordPress APIの呼び出しに失敗しました';
        continue;
      }
      if (result.data) {
        const normalized = normalizePostResponse(result.data);
        if (normalized.id) {
          const payload: { id: number } & Partial<{ link: string; title: string }> = {
            id: normalized.id,
          };
          if (normalized.link) {
            payload.link = normalized.link;
          }
          if (normalized.title) {
            payload.title = normalized.title;
          }
          return payload;
        }
      }
    }
    if (lastError) {
      return { error: lastError };
    }
    return null;
  };

  let canonicalFromApi: string | undefined;
  let resolvedWpId: number | null = null;
  let resolvedTitle: string | null = null;
  let resolvedCategories: number[] | null = null;
  let resolvedCategoryNames: string[] | null = null;

  const postResult = await resolveByType('posts');
  if (postResult && 'error' in postResult) {
    return { success: false as const, error: postResult.error };
  }
  if (postResult && postResult !== null) {
    resolvedWpId = postResult.id;
    canonicalFromApi = postResult.link ?? canonicalFromApi;
    resolvedTitle = postResult.title ?? resolvedTitle;
  }

  if (resolvedWpId == null) {
    const pageResult = await resolveByType('pages');
    if (pageResult && 'error' in pageResult) {
      return { success: false as const, error: pageResult.error };
    }
    if (pageResult && pageResult !== null) {
      resolvedWpId = pageResult.id;
      canonicalFromApi = pageResult.link ?? canonicalFromApi;
      resolvedTitle = pageResult.title ?? resolvedTitle;
    }
  }

  if (resolvedWpId == null) {
    return {
      success: false as const,
      error: ERROR_MESSAGES.WORDPRESS.POST_NOT_FOUND,
    };
  }

  // カテゴリー情報を取得するため、再度 resolveContentById を呼び出す（_embed=true で取得）
  if (resolvedWpId !== null) {
    const byIdWithEmbed = await wpService.resolveContentById(resolvedWpId);
    if (byIdWithEmbed.success && byIdWithEmbed.data) {
      const normalizedWithEmbed = normalizePostResponse(byIdWithEmbed.data);
      resolvedCategories = normalizedWithEmbed.categories ?? null;
      resolvedCategoryNames = normalizedWithEmbed.categoryNames ?? null;
    }
  }

  return {
    success: true as const,
    canonicalUrl: canonicalFromApi ?? canonicalCandidate,
    wpPostId: resolvedWpId,
    wpPostTitle: resolvedTitle ?? null,
    wpCategories: resolvedCategories,
    wpCategoryNames: resolvedCategoryNames,
  };
}

async function parseRssAndNormalize(
  siteUrlClean: string,
  page: number,
  perPage: number
): Promise<RssNormalizeResult | null> {
  const rssCandidates = [`${siteUrlClean}/feed/`, `${siteUrlClean}/?feed=rss2`];
  for (const rssUrl of rssCandidates) {
    try {
      const rssHeaders: HeadersInit = {
        'User-Agent': 'IndustrySpecificMC/1.0 (+app)',
        Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      };
      const rssResp = await fetch(rssUrl, { headers: rssHeaders, cache: 'no-store' });
      if (!rssResp.ok) {
        const lastStatus = rssResp.status;
        const lastErrorText = await rssResp.text().catch(() => rssResp.statusText);
        console.error('[WP posts] RSS fetch failed candidate', {
          url: rssUrl,
          status: lastStatus,
          txt: lastErrorText,
        });
        continue;
      }
      const xml = await rssResp.text();

      const items: RssItem[] = [];

      const itemRegex = /<item[\s\S]*?<\/item>/g;
      const titleRegex = /<title>([\s\S]*?)<\/title>/i;
      const linkRegex = /<link>([\s\S]*?)<\/link>/i;
      const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
      const descRegex = /<description>([\s\S]*?)<\/description>/i;
      const catRegex = /<category[^>]*>([\s\S]*?)<\/category>/gi;

      const decodeCdata = (v: string) =>
        v
          .replace(/^\s*<!\[CDATA\[/, '')
          .replace(/\]\]>\s*$/, '')
          .trim();
      const stripTags = (v: string) => v.replace(/<[^>]+>/g, '').trim();

      const matches = xml.match(itemRegex) || [];
      for (const raw of matches) {
        const titleMatch = titleRegex.exec(raw)?.[1];
        const linkMatch = linkRegex.exec(raw)?.[1];
        const pubDateMatch = pubDateRegex.exec(raw)?.[1];
        const descriptionMatch = descRegex.exec(raw)?.[1];
        const cats: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = catRegex.exec(raw)) !== null) {
          if (m[1]) cats.push(stripTags(decodeCdata(m[1])));
        }
        const item: RssItem = {};
        if (titleMatch) item.title = stripTags(decodeCdata(titleMatch));
        if (linkMatch) item.link = linkMatch.trim();
        if (pubDateMatch) item.pubDate = pubDateMatch.trim();
        if (descriptionMatch) item.description = stripTags(decodeCdata(descriptionMatch));
        if (cats.length > 0) item.categories = cats;
        items.push(item);
      }

      const start = (page - 1) * perPage;
      const end = start + perPage;
      const sliced = items.slice(start, end);

      const normalized: WordPressNormalizedPost[] = sliced.map((it, idx) => {
        const n: WordPressNormalizedPost = {
          id: start + idx + 1,
          categoryNames: [],
        };
        if (it.pubDate) n.date = it.pubDate;
        if (it.title) n.title = it.title;
        if (it.link) {
          n.link = it.link;
          n.canonical_url = it.link;
        }
        n.categoryNames = it.categories || [];
        if (it.description) n.excerpt = it.description;
        return n;
      });

      return { normalized, total: items.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown RSS fetch error';
      console.error('[WP posts] RSS exception candidate', { url: rssUrl, error: msg });
      continue;
    }
  }
  return null;
}

export async function getWordPressPostsForCurrentUser(page: number, perPage: number) {
  return withAuth(async ({ userId, cookieStore, viewModeRole }) => {
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false as const, error: VIEW_MODE_ERROR_MESSAGE };
    }
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(userId);

    if (!wpSettings) {
      return { success: true as const, data: { posts: [], total: 0 } };
    }

    const getCookie = (name: string) => cookieStore.get(name)?.value;
    const rest = await getRestRequestConfig(wpSettings, getCookie, page, perPage);
    if (rest.error) {
      return { success: false as const, error: rest.error };
    }

    const { resp, lastStatus, lastErrorText } = await tryFetchCandidates(
      rest.candidates,
      rest.headers
    );

    if (!resp) {
      if (rest.isSelfHosted && rest.siteUrlClean) {
        const rss = await parseRssAndNormalize(rest.siteUrlClean, page, perPage);
        if (rss) {
          return { success: true as const, data: { posts: rss.normalized, total: rss.total } };
        }
      }
      return {
        success: false as const,
        error: ERROR_MESSAGES.WORDPRESS.POSTS_FETCH_ERROR_HTTP(lastStatus, lastErrorText),
      };
    }

    const postsJson: unknown = await resp.json();
    const headerTotal = parseInt(resp.headers.get('X-WP-Total') || '0', 10);
    const total =
      Number.isFinite(headerTotal) && headerTotal > 0
        ? headerTotal
        : Array.isArray(postsJson)
          ? (postsJson as unknown[]).length
          : 0;
    const posts: WordPressRestPost[] = Array.isArray(postsJson)
      ? (postsJson as WordPressRestPost[])
      : [];
    const normalized = normalizeWordPressRestPosts(posts);

    return { success: true as const, data: { posts: normalized, total } };
  });
}

// ==========================================
// Annotations (ユーザー入力) CRUD
// ==========================================

export async function upsertContentAnnotation(payload: ContentAnnotationPayload): Promise<
  | { success: false; error: string }
  | {
      success: true;
      canonical_url?: string | null;
      wp_post_id?: number | null;
      wp_post_title?: string | null;
    }
> {
  return withAuth(async ({ userId, cookieStore, viewModeRole }) => {
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false as const, error: VIEW_MODE_ERROR_MESSAGE };
    }
    const supabaseServiceLocal = new SupabaseService();
    const client = supabaseServiceLocal.getClient();

    const canonicalProvided = Object.prototype.hasOwnProperty.call(payload, 'canonical_url');
    const nextCanonicalRaw = (payload.canonical_url ?? '').trim();
    let existingAnnotation: ExistingAnnotationData | null = null;
    let canonicalMatchesExisting = false;

    if (canonicalProvided && payload.wp_post_id !== undefined && payload.wp_post_id !== null) {
      const { data: existingData, error: existingError } = await client
        .from('content_annotations')
        .select('canonical_url, wp_post_id, wp_post_title')
        .eq('user_id', userId)
        .eq('wp_post_id', payload.wp_post_id)
        .maybeSingle();
      if (!existingError && existingData) {
        const typed = existingData as ExistingAnnotationData;
        existingAnnotation = {
          canonical_url: typed.canonical_url ?? null,
          wp_post_id: typed.wp_post_id ?? null,
          wp_post_title: typed.wp_post_title ?? null,
        };

        const existingCanonicalRaw = (existingAnnotation.canonical_url ?? '').trim();
        if (existingCanonicalRaw || nextCanonicalRaw) {
          try {
            const existingNormalized = existingCanonicalRaw
              ? new URL(existingCanonicalRaw).toString()
              : '';
            const nextNormalized = nextCanonicalRaw ? new URL(nextCanonicalRaw).toString() : '';
            canonicalMatchesExisting = existingNormalized === nextNormalized;
          } catch {
            canonicalMatchesExisting = existingCanonicalRaw === nextCanonicalRaw;
          }
        } else {
          canonicalMatchesExisting = true;
        }
      }
    }

    let resolvedCanonicalUrl: string | null = payload.canonical_url ?? null;
    let resolvedWpId: number | null = payload.wp_post_id ?? null;
    let resolvedWpTitle: string | null | undefined = undefined;
    let resolvedWpCategories: number[] | null = null;
    let resolvedWpCategoryNames: string[] | null = null;

    if (canonicalProvided) {
      const resolution = await resolveCanonicalAndWpPostId({
        canonicalUrl: payload.canonical_url,
        supabaseService: supabaseServiceLocal,
        userId,
        cookieStore,
      });
      if (!resolution.success) {
        if (canonicalMatchesExisting && existingAnnotation) {
          resolvedCanonicalUrl = existingAnnotation.canonical_url ?? null;
          resolvedWpId = existingAnnotation.wp_post_id ?? null;
          resolvedWpTitle = existingAnnotation.wp_post_title ?? null;
        } else {
          return { success: false as const, error: resolution.error };
        }
      } else {
        resolvedCanonicalUrl = resolution.canonicalUrl;
        resolvedWpId = resolution.wpPostId;
        resolvedWpTitle = resolution.wpPostTitle ?? null;
        resolvedWpCategories = resolution.wpCategories ?? null;
        resolvedWpCategoryNames = resolution.wpCategoryNames ?? null;
      }
    }

    if (canonicalProvided && resolvedCanonicalUrl && !canonicalMatchesExisting) {
      const { data: duplicateRows, error: duplicateError } = await client
        .from('content_annotations')
        .select('session_id, wp_post_id')
        .eq('user_id', userId)
        .eq('canonical_url', resolvedCanonicalUrl);

      if (duplicateError) {
        return { success: false as const, error: duplicateError.message };
      }

      const hasConflict = (duplicateRows ?? []).some(row => {
        const typed = row as Pick<AnnotationRecord, 'session_id' | 'wp_post_id'>;
        const sameWp =
          typeof typed.wp_post_id === 'number' && typeof resolvedWpId === 'number'
            ? typed.wp_post_id === resolvedWpId
            : false;
        return !sameWp;
      });

      if (hasConflict) {
        return {
          success: false as const,
          error: DUPLICATE_CANONICAL_ERROR_MESSAGE,
        };
      }
    }

    // WordPress記事本文のキャッシュを取得
    let wpContentCache: string | null = null;

    if (resolvedWpId) {
      try {
        const getCookieFunc = (name: string) => cookieStore.get(name)?.value;
        const ctx = await resolveWordPressContext(getCookieFunc);

        if (ctx.success) {
          const post = await ctx.service.resolveContentById(resolvedWpId);
          if (post.success && post.data) {
            const rawContent = post.data.content;
            const contentHtml =
              typeof rawContent === 'string'
                ? rawContent
                : typeof (rawContent as { rendered?: unknown })?.rendered === 'string'
                  ? (rawContent as { rendered: string }).rendered
                  : '';
            const text = stripHtml(contentHtml).trim();
            if (text) {
              wpContentCache = text;
            }
          }
        }
      } catch (error) {
        console.error('[upsertContentAnnotation] WordPress記事本文の取得に失敗:', error);
        // エラーが発生してもアノテーション保存は続行
      }
    }

    const upsertData: Database['public']['Tables']['content_annotations']['Insert'] = {
      user_id: userId,
      wp_post_id: resolvedWpId,
      canonical_url: canonicalProvided ? resolvedCanonicalUrl : (payload.canonical_url ?? null),
      main_kw: payload.main_kw ?? null,
      kw: payload.kw ?? null,
      impressions: payload.impressions ?? null,
      persona: payload.persona ?? null,
      needs: payload.needs ?? null,
      goal: payload.goal ?? null,
      prep: payload.prep ?? null,
      basic_structure: payload.basic_structure ?? null,
      opening_proposal: payload.opening_proposal ?? null,
      wp_content_text: wpContentCache ?? null,
      updated_at: new Date().toISOString(),
      ...(canonicalProvided
        ? {
            wp_post_title: resolvedWpTitle ?? null,
            ...(resolvedWpCategories !== null ? { wp_categories: resolvedWpCategories } : {}),
            ...(resolvedWpCategoryNames !== null
              ? { wp_category_names: resolvedWpCategoryNames }
              : {}),
          }
        : {}),
    };

    const { error } = await client
      .from('content_annotations')
      .upsert(upsertData, { onConflict: 'user_id,wp_post_id' });

    if (error) {
      if (isDuplicateCanonicalConstraint(error)) {
        return { success: false as const, error: DUPLICATE_CANONICAL_ERROR_MESSAGE };
      }
      return { success: false as const, error: error.message };
    }

    return {
      success: true as const,
      ...(canonicalProvided
        ? { canonical_url: resolvedCanonicalUrl ?? null, wp_post_id: resolvedWpId ?? null }
        : {}),
      ...(canonicalProvided ? { wp_post_title: resolvedWpTitle ?? null } : {}),
    };
  });
}

export async function getContentAnnotationsForUser(): Promise<
  { success: false; error: string } | { success: true; data: AnnotationRecord[] }
> {
  return withAuth(async ({ userId }) => {
    const client = new SupabaseService().getClient();
    const { data, error } = await client
      .from('content_annotations')
      .select('*')
      .eq('user_id', userId);

    if (error) return { success: false as const, error: error.message };
    const typedData = (data ?? []) as AnnotationRecord[];
    return { success: true as const, data: typedData };
  });
}

export async function saveWordPressSettingsAction(params: SaveWordPressSettingsParams) {
  try {
    const { wpType, wpSiteId, wpSiteUrl, wpUsername, wpApplicationPassword, wpContentTypes } =
      params;
    const contentTypes = normalizeContentTypes(wpContentTypes);

    // 認証情報はCookieから取得（セキュリティベストプラクティス）
    const { accessToken: liffToken, refreshToken } = await getLiffTokensFromCookies();

    if (!liffToken || !wpType) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.AUTH.AUTHENTICATION_REQUIRED,
      };
    }

    const authResult = await authMiddleware(liffToken, refreshToken);
    if (authResult.error || !authResult.userId || !authResult.userDetails?.role) {
      return { success: false as const, error: ERROR_MESSAGES.AUTH.AUTHENTICATION_FAILED };
    }

    // View Modeの場合でも、本来のユーザー（オーナー）として実行する
    const realUserId = authResult.actorUserId || authResult.userId;
    const isRealOwner = !!authResult.actorUserId;
    const effectiveOwnerId = isRealOwner ? null : (authResult.ownerUserId ?? null);

    if (effectiveOwnerId) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED,
      };
    }

    const isAdmin = isAdminRole(authResult.userDetails.role);

    if (!isAdmin && wpType !== 'self_hosted') {
      return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.WORDPRESS_COM_ADMIN_ONLY };
    }

    if (wpType === 'self_hosted') {
      if (!wpSiteUrl || !wpUsername || !wpApplicationPassword) {
        return {
          success: false as const,
          error: ERROR_MESSAGES.WORDPRESS.SELF_HOSTED_REQUIRED_FIELDS,
        };
      }

      await supabaseService.createOrUpdateSelfHostedWordPressSettings(
        realUserId,
        wpSiteUrl,
        wpUsername,
        wpApplicationPassword,
        { wpContentTypes: contentTypes }
      );
    } else if (wpType === 'wordpress_com') {
      if (!wpSiteId) {
        return {
          success: false as const,
          error: ERROR_MESSAGES.WORDPRESS.WORDPRESS_COM_SITE_ID_REQUIRED,
        };
      }

      await supabaseService.createOrUpdateWordPressSettings(realUserId, '', '', wpSiteId, {
        wpContentTypes: contentTypes,
      });
    }

    return { success: true as const, message: ERROR_MESSAGES.WORDPRESS.SETTINGS_SAVED };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
    };
  }
}

// ==========================================
// WordPress 接続テスト（サーバーアクション）
// 保存済み設定を用いて接続を確認する
// ==========================================

export async function testWordPressConnectionAction() {
  try {
    const { accessToken: liffToken, refreshToken } = await getLiffTokensFromCookies();
    const authResult = await authMiddleware(liffToken, refreshToken);

    if (authResult.error || !authResult.userId || !authResult.userDetails?.role) {
      return { success: false as const, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    if (authResult.viewMode || authResult.ownerUserId) {
      return {
        success: false as const,
        error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED,
      };
    }
    // 本人のオーナーアカウントのみがテスト接続を実行可能（View Mode・スタッフアカウント禁止）

    const isAdmin = isAdminRole(authResult.userDetails.role);
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(authResult.userId);

    if (!wpSettings) {
      return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.SETTINGS_NOT_REGISTERED };
    }

    if (!isAdmin && wpSettings.wpType === 'wordpress_com') {
      return {
        success: false as const,
        error:
          '管理者以外はWordPress.com接続テストを実行できません。セルフホスト版で再設定してください。',
      };
    }

    const cookieStore = await cookies();
    const context = await resolveWordPressContext(name => cookieStore.get(name)?.value, {
      supabaseService,
    });

    if (!context.success) {
      switch (context.reason) {
        case 'line_auth_invalid':
        case 'requires_reauth':
          return {
            success: false as const,
            error: context.message || 'ユーザー認証に失敗しました',
          };
        case 'settings_missing':
          return {
            success: false as const,
            error: ERROR_MESSAGES.WORDPRESS.SETTINGS_NOT_REGISTERED,
          };
        case 'wordpress_auth_missing':
          return {
            success: false as const,
            error: context.message,
            needsWordPressAuth: true,
          } as const;
        default:
          return { success: false as const, error: context.message };
      }
    }

    const connectionTest = await context.service.testConnection();
    if (!connectionTest.success) {
      return {
        success: false as const,
        error:
          connectionTest.error ||
          `${
            context.wpSettings.wpType === 'wordpress_com'
              ? 'WordPress.com'
              : 'セルフホストWordPress'
          }への接続テストに失敗しました。`,
      };
    }

    return {
      success: true as const,
      message: `${
        context.wpSettings.wpType === 'wordpress_com' ? 'WordPress.com' : 'セルフホストWordPress'
      }接続テストが成功しました`,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : '接続テスト中に予期せぬエラーが発生しました',
    };
  }
}

// ==========================================
// セッション基盤の保存/取得/公開機能
// ==========================================

export async function getContentAnnotationBySession(
  session_id: string
): Promise<{ success: false; error: string } | { success: true; data: AnnotationRecord | null }> {
  return withAuth(async ({ userId }) => {
    const client = new SupabaseService().getClient();

    // アクセス可能なユーザーIDを取得（オーナー/従業員の相互閲覧対応）
    const { data: accessibleIds, error: accessError } = await client.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return { success: false as const, error: 'アクセス権の確認に失敗しました' };
    }

    const { data, error } = await client
      .from('content_annotations')
      .select('*')
      .in('user_id', accessibleIds)
      .eq('session_id', session_id)
      .maybeSingle();

    if (error) return { success: false as const, error: error.message };
    const typedData = (data ?? null) as AnnotationRecord | null;
    return { success: true as const, data: typedData };
  });
}

export async function upsertContentAnnotationBySession(
  payload: SessionAnnotationUpsertPayload & {
    wp_post_id?: number | null;
  }
): Promise<
  | { success: false; error: string }
  | {
      success: true;
      canonical_url?: string | null;
      wp_post_id?: number | null;
      wp_post_title?: string | null;
    }
> {
  return withAuth(async ({ userId, cookieStore, viewModeRole, ownerUserId, userDetails }) => {
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false as const, error: VIEW_MODE_ERROR_MESSAGE };
    }

    // セッションベースのアノテーション編集の権限チェック
    // - スタッフユーザー（ownerUserId が設定されている）→ 編集可能
    // - 独立ユーザー（role!='owner' かつ ownerUserId=null）→ 編集可能
    // - オーナー（role='owner' かつ ownerUserId=null）→ 編集不可（閲覧のみ）
    const isStaffUser = Boolean(ownerUserId);
    const isActualOwner = isActualOwnerHelper(userDetails?.role ?? null, ownerUserId);
    if (!isStaffUser && isActualOwner) {
      return {
        success: false as const,
        error: 'オーナーはコンテンツの編集ができません。従業員のみ編集可能です。',
      };
    }

    const supabaseServiceLocal = new SupabaseService();
    const client = supabaseServiceLocal.getClient();

    // アクセス可能なユーザーIDを取得（従業員: 自分＋オーナー）
    const { data: accessibleIds, error: accessError } = await client.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return { success: false as const, error: 'アクセス権の確認に失敗しました' };
    }

    // セッションの所有者を確認
    const { data: sessionData, error: sessionError } = await client
      .from('chat_sessions')
      .select('user_id')
      .eq('id', payload.session_id)
      .maybeSingle();

    if (sessionError || !sessionData) {
      return { success: false as const, error: 'セッション情報の取得に失敗しました' };
    }

    const sessionOwnerId = sessionData.user_id;

    // セッション所有者がアクセス可能かチェック
    if (!accessibleIds.includes(sessionOwnerId)) {
      return { success: false as const, error: 'このセッションを編集する権限がありません' };
    }

    const canonicalProvided = Object.prototype.hasOwnProperty.call(payload, 'canonical_url');
    const nextCanonicalRaw = (payload.canonical_url ?? '').trim();
    let existingAnnotation: ExistingAnnotationData | null = null;
    let canonicalMatchesExisting = false;

    if (canonicalProvided) {
      const { data: existingData, error: existingError } = await client
        .from('content_annotations')
        .select('canonical_url, wp_post_id, wp_post_title')
        .eq('user_id', sessionOwnerId)
        .eq('session_id', payload.session_id)
        .maybeSingle();
      if (!existingError && existingData) {
        const typed = existingData as ExistingAnnotationData;
        existingAnnotation = {
          canonical_url: typed.canonical_url ?? null,
          wp_post_id: typed.wp_post_id ?? null,
          wp_post_title: typed.wp_post_title ?? null,
        };

        const existingCanonicalRaw = (existingAnnotation.canonical_url ?? '').trim();
        if (existingCanonicalRaw || nextCanonicalRaw) {
          try {
            const existingNormalized = existingCanonicalRaw
              ? new URL(existingCanonicalRaw).toString()
              : '';
            const nextNormalized = nextCanonicalRaw ? new URL(nextCanonicalRaw).toString() : '';
            canonicalMatchesExisting = existingNormalized === nextNormalized;
          } catch {
            canonicalMatchesExisting = existingCanonicalRaw === nextCanonicalRaw;
          }
        } else {
          canonicalMatchesExisting = true;
        }
      }
    }

    let resolvedCanonicalUrl: string | null | undefined = undefined;
    let resolvedWpId: number | null | undefined = undefined;
    let resolvedWpTitle: string | null | undefined = undefined;
    let resolvedWpCategories: number[] | null | undefined = undefined;
    let resolvedWpCategoryNames: string[] | null | undefined = undefined;

    if (canonicalProvided) {
      const resolution = await resolveCanonicalAndWpPostId({
        canonicalUrl: payload.canonical_url,
        supabaseService: supabaseServiceLocal,
        userId: sessionOwnerId, // セッション所有者のWordPress設定を使用
        cookieStore,
      });
      if (!resolution.success) {
        if (canonicalMatchesExisting && existingAnnotation) {
          resolvedCanonicalUrl = existingAnnotation.canonical_url ?? null;
          resolvedWpId = existingAnnotation.wp_post_id ?? null;
          resolvedWpTitle = existingAnnotation.wp_post_title ?? null;
        } else {
          return { success: false as const, error: resolution.error };
        }
      } else {
        resolvedCanonicalUrl = resolution.canonicalUrl;
        resolvedWpId = resolution.wpPostId;
        resolvedWpTitle = resolution.wpPostTitle ?? null;
        resolvedWpCategories = resolution.wpCategories ?? null;
        resolvedWpCategoryNames = resolution.wpCategoryNames ?? null;
      }
    }

    if (canonicalProvided && resolvedCanonicalUrl && !canonicalMatchesExisting) {
      const { data: duplicateRows, error: duplicateError } = await client
        .from('content_annotations')
        .select('session_id, wp_post_id')
        .eq('user_id', sessionOwnerId)
        .eq('canonical_url', resolvedCanonicalUrl);

      if (duplicateError) {
        return { success: false as const, error: duplicateError.message };
      }

      const hasConflict = (duplicateRows ?? []).some(row => {
        const typed = row as Pick<AnnotationRecord, 'session_id' | 'wp_post_id'>;
        const sameSession =
          typeof typed.session_id === 'string' && typed.session_id === payload.session_id;
        const sameWp =
          typeof typed.wp_post_id === 'number' && typeof resolvedWpId === 'number'
            ? typed.wp_post_id === resolvedWpId
            : false;
        return !(sameSession || sameWp);
      });

      if (hasConflict) {
        return {
          success: false as const,
          error: DUPLICATE_CANONICAL_ERROR_MESSAGE,
        };
      }
    }

    const upsertPayload: Database['public']['Tables']['content_annotations']['Insert'] = {
      user_id: sessionOwnerId, // セッション所有者のIDで保存
      session_id: payload.session_id,
      main_kw: payload.main_kw ?? null,
      kw: payload.kw ?? null,
      impressions: payload.impressions ?? null,
      persona: payload.persona ?? null,
      needs: payload.needs ?? null,
      goal: payload.goal ?? null,
      prep: payload.prep ?? null,
      basic_structure: payload.basic_structure ?? null,
      opening_proposal: payload.opening_proposal ?? null,
      updated_at: new Date().toISOString(),
      ...(canonicalProvided
        ? {
            canonical_url: resolvedCanonicalUrl ?? null,
            wp_post_id: resolvedWpId ?? null,
            wp_post_title: resolvedWpTitle ?? null,
            ...(resolvedWpCategories !== null && resolvedWpCategories !== undefined
              ? { wp_categories: resolvedWpCategories }
              : {}),
            ...(resolvedWpCategoryNames !== null && resolvedWpCategoryNames !== undefined
              ? { wp_category_names: resolvedWpCategoryNames }
              : {}),
          }
        : {}),
    };

    const { error } = await client
      .from('content_annotations')
      .upsert(upsertPayload, { onConflict: 'session_id' });

    if (error) {
      if (isDuplicateCanonicalConstraint(error)) {
        return { success: false as const, error: DUPLICATE_CANONICAL_ERROR_MESSAGE };
      }
      return { success: false as const, error: error.message };
    }
    return {
      success: true as const,
      ...(canonicalProvided
        ? {
            canonical_url: resolvedCanonicalUrl ?? null,
            wp_post_id: resolvedWpId ?? null,
          }
        : {}),
      ...(canonicalProvided ? { wp_post_title: resolvedWpTitle ?? null } : {}),
    };
  });
}

export interface EnsureAnnotationChatSessionPayload {
  sessionId?: string | null;
  annotationId?: string | null;
  wpPostId?: number | null;
  wpPostTitle?: string | null;
  canonicalUrl?: string | null;
  fallbackTitle?: string | null;
}

export async function ensureAnnotationChatSession(
  payload: EnsureAnnotationChatSessionPayload
): Promise<{ success: true; sessionId: string } | { success: false; error: string }> {
  return withAuth(async ({ userId, ownerUserId, viewModeRole }) => {
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false as const, error: VIEW_MODE_ERROR_MESSAGE };
    }
    const targetUserId = ownerUserId || userId;
    const service = new SupabaseService();
    const client = service.getClient();

    const annotationId =
      payload.annotationId && payload.annotationId.trim().length > 0
        ? payload.annotationId.trim()
        : null;

    type AnnotationByIdRow = { id: string; session_id: string | null; wp_post_id: number | null };
    let annotationById: AnnotationByIdRow | null = null;

    if (annotationId) {
      const { data, error } = await client
        .from('content_annotations')
        .select('id, session_id, wp_post_id')
        .eq('user_id', targetUserId)
        .eq('id', annotationId)
        .maybeSingle();

      if (error) {
        return { success: false as const, error: error.message };
      }

      annotationById = (data as AnnotationByIdRow | null) ?? null;
    }

    let sessionId: string | null = payload.sessionId?.trim() ? payload.sessionId.trim()! : null;

    if (!sessionId && annotationById?.session_id) {
      sessionId = annotationById.session_id;
    }

    if (sessionId) {
      const existingSession = await service.getChatSessionById(sessionId, targetUserId);
      if (!existingSession.success) {
        return { success: false as const, error: existingSession.error.userMessage };
      }
      if (!existingSession.data) {
        sessionId = null;
      }
    }

    const nowIso = new Date().toISOString();

    if (!sessionId) {
      sessionId = randomUUID();
      const baseTitle =
        (payload.wpPostTitle && payload.wpPostTitle.trim()) ||
        (payload.fallbackTitle && payload.fallbackTitle.trim()) ||
        'チャットセッション';

      const session: DbChatSession = {
        id: sessionId,
        user_id: targetUserId,
        title: baseTitle.length > 60 ? `${baseTitle.slice(0, 57)}...` : baseTitle,
        created_at: nowIso,
        last_message_at: nowIso,
        system_prompt: null,
        search_vector: null,
        service_id: null,
      };

      const createResult = await service.createChatSession(session);
      if (!createResult.success) {
        return { success: false as const, error: createResult.error.userMessage };
      }
    }

    const hasValidWpId = typeof payload.wpPostId === 'number' && Number.isFinite(payload.wpPostId);
    const annotationUpdate: Record<string, unknown> = {
      session_id: sessionId,
      updated_at: nowIso,
    };

    if (hasValidWpId) {
      annotationUpdate.wp_post_id = payload.wpPostId;
    }
    if (payload.wpPostTitle !== undefined) {
      annotationUpdate.wp_post_title = payload.wpPostTitle ?? null;
    }
    if (payload.canonicalUrl !== undefined) {
      annotationUpdate.canonical_url =
        payload.canonicalUrl && payload.canonicalUrl.trim().length > 0
          ? payload.canonicalUrl
          : null;
    }

    let annotationLinked = false;

    if (annotationId && annotationById) {
      const { error: updateByIdError } = await client
        .from('content_annotations')
        .update(annotationUpdate)
        .eq('user_id', targetUserId)
        .eq('id', annotationId);
      if (updateByIdError) {
        return { success: false as const, error: updateByIdError.message };
      }
      annotationLinked = true;
    }

    if (!annotationLinked && hasValidWpId) {
      const { error: fetchByWpError, data: existingByWp } = await client
        .from('content_annotations')
        .select('session_id')
        .eq('user_id', targetUserId)
        .eq('wp_post_id', payload.wpPostId as number)
        .maybeSingle();

      if (fetchByWpError) {
        return { success: false as const, error: fetchByWpError.message };
      }

      if (existingByWp) {
        annotationLinked = true;
        const { error: updateError } = await client
          .from('content_annotations')
          .update(annotationUpdate)
          .eq('user_id', targetUserId)
          .eq('wp_post_id', payload.wpPostId as number);
        if (updateError) {
          return { success: false as const, error: updateError.message };
        }
      }
    }

    if (!annotationLinked) {
      const { error: fetchBySessionError, data: existingBySession } = await client
        .from('content_annotations')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('session_id', sessionId)
        .maybeSingle();

      if (fetchBySessionError) {
        return { success: false as const, error: fetchBySessionError.message };
      }

      if (existingBySession) {
        const { error: updateError } = await client
          .from('content_annotations')
          .update(annotationUpdate)
          .eq('user_id', targetUserId)
          .eq('session_id', sessionId);
        if (updateError) {
          return { success: false as const, error: updateError.message };
        }
      } else {
        const insertPayload: Database['public']['Tables']['content_annotations']['Insert'] = {
          user_id: targetUserId,
          session_id: sessionId,
          ...annotationUpdate,
        };
        const { error: insertError } = await client
          .from('content_annotations')
          .insert(insertPayload);
        if (insertError) {
          if (isDuplicateCanonicalConstraint(insertError)) {
            return { success: false as const, error: DUPLICATE_CANONICAL_ERROR_MESSAGE };
          }
          return { success: false as const, error: insertError.message };
        }
      }
    }

    return { success: true as const, sessionId };
  });
}

/**
 * WordPress接続ステータスを取得
 * SetupDashboard で使用
 */
export interface WordPressConnectionStatus {
  connected: boolean;
  status: 'connected' | 'error' | 'not_configured';
  message: string;
  wpType?: 'wordpress_com' | 'self_hosted';
  lastUpdated?: string | null;
}

/**
 * content_annotations の特定フィールドを ID で直接更新
 * GSC ダッシュボードの改善提案データ不足時に使用
 */
export async function updateContentAnnotationFields(
  annotationId: string,
  fields: {
    canonical_url?: string | null;
    wp_post_title?: string | null;
    wp_excerpt?: string | null;
    wp_content_text?: string | null;
    opening_proposal?: string | null;
    persona?: string | null;
    needs?: string | null;
    main_kw?: string | null;
    kw?: string | null;
    impressions?: string | number | null;
    goal?: string | null;
    prep?: string | null;
    basic_structure?: string | null;
  }
): Promise<
  | { success: true; wp_post_id?: number | null; wp_post_title?: string | null }
  | { success: false; error: string }
> {
  // annotationId のバリデーション
  if (!annotationId || typeof annotationId !== 'string' || annotationId.trim().length === 0) {
    return { success: false as const, error: ERROR_MESSAGES.WORDPRESS.INVALID_ANNOTATION_ID };
  }

  return withAuth(async ({ userId, ownerUserId, cookieStore, viewModeRole }) => {
    const targetUserId = ownerUserId || userId;
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false as const, error: VIEW_MODE_ERROR_MESSAGE };
    }
    const supabaseServiceLocal = new SupabaseService();
    const client = supabaseServiceLocal.getClient();

    let resolvedCanonicalUrl: string | null | undefined = undefined;
    let resolvedWpId: number | null | undefined = undefined;
    let resolvedWpTitle: string | null | undefined = undefined;

    // canonical_url が指定されている場合、WordPress投稿IDを解決
    if (Object.prototype.hasOwnProperty.call(fields, 'canonical_url')) {
      const resolution = await resolveCanonicalAndWpPostId({
        canonicalUrl: fields.canonical_url,
        supabaseService: supabaseServiceLocal,
        userId,
        cookieStore,
      });
      if (!resolution.success) {
        return { success: false as const, error: resolution.error };
      }
      resolvedCanonicalUrl = resolution.canonicalUrl;
      resolvedWpId = resolution.wpPostId;
      resolvedWpTitle = resolution.wpPostTitle;
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // フィールドが指定されている場合のみ更新
    if (Object.prototype.hasOwnProperty.call(fields, 'canonical_url')) {
      updateData.canonical_url = resolvedCanonicalUrl ?? null;
      if (resolvedWpId !== undefined) {
        updateData.wp_post_id = resolvedWpId ?? null;
      }
      if (resolvedWpTitle !== undefined && resolvedWpTitle !== null) {
        updateData.wp_post_title = resolvedWpTitle;
      }
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'wp_post_title')) {
      updateData.wp_post_title = fields.wp_post_title ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'wp_excerpt')) {
      updateData.wp_excerpt = fields.wp_excerpt ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'wp_content_text')) {
      updateData.wp_content_text = fields.wp_content_text ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'opening_proposal')) {
      updateData.opening_proposal = fields.opening_proposal ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'persona')) {
      updateData.persona = fields.persona ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'needs')) {
      updateData.needs = fields.needs ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'main_kw')) {
      updateData.main_kw = fields.main_kw ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'kw')) {
      updateData.kw = fields.kw ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'impressions')) {
      updateData.impressions =
        fields.impressions === null || fields.impressions === undefined
          ? null
          : Number.isFinite(Number(fields.impressions))
            ? Number(fields.impressions)
            : fields.impressions;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'goal')) {
      updateData.goal = fields.goal ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'prep')) {
      updateData.prep = fields.prep ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'basic_structure')) {
      updateData.basic_structure = fields.basic_structure ?? null;
    }

    const { error } = await client
      .from('content_annotations')
      .update(updateData)
      .eq('id', annotationId)
      .eq('user_id', targetUserId);

    if (error) {
      return { success: false as const, error: error.message };
    }

    return {
      success: true as const,
      ...(resolvedWpId !== undefined ? { wp_post_id: resolvedWpId ?? null } : {}),
      ...(resolvedWpTitle !== undefined ? { wp_post_title: resolvedWpTitle ?? null } : {}),
    };
  });
}

export async function fetchWordPressStatusAction(): Promise<
  { success: true; data: WordPressConnectionStatus } | { success: false; error: string }
> {
  return withAuth(async ({ userId, cookieStore, userDetails, ownerUserId, actorUserId }) => {
    // View Modeの場合は本来のユーザー（オーナー）を使用
    const realUserId = actorUserId || userId;
    const isRealOwner = !!actorUserId;
    const effectiveOwnerId = isRealOwner ? null : ownerUserId;

    if (effectiveOwnerId) {
      return {
        success: false,
        error: ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED,
      };
    }
    const wpSettings = await supabaseService.getWordPressSettingsByUserId(realUserId);
    const isAdmin = isAdminRole(userDetails?.role ?? null);

    // 設定が未完了の場合
    if (!wpSettings) {
      return {
        success: true,
        data: {
          connected: false,
          status: 'not_configured' as const,
          message: 'WordPress設定が未完了です',
        },
      };
    }

    if (!isAdmin && wpSettings.wpType === 'wordpress_com') {
      return {
        success: true,
        data: {
          connected: false,
          status: 'error' as const,
          message:
            'WordPress.com 連携は管理者のみ利用できます。セルフホスト版で再設定してください。',
          wpType: wpSettings.wpType,
          lastUpdated: wpSettings.updatedAt ?? null,
        },
      };
    }

    // WordPress コンテキストを解決
    const getCookie = (name: string) => cookieStore.get(name)?.value;
    const context = await resolveWordPressContext(getCookie);

    if (!context.success) {
      if (context.reason === 'wordpress_auth_missing' && context.wpSettings) {
        return {
          success: true,
          data: {
            connected: false,
            status: 'error' as const,
            message: context.message,
            wpType: context.wpSettings.wpType,
            lastUpdated: context.wpSettings.updatedAt ?? null,
          },
        };
      }

      return { success: false, error: context.message };
    }

    // 接続テスト
    const testResult = await context.service.testConnection();

    if (!testResult.success) {
      return {
        success: true,
        data: {
          connected: false,
          status: 'error' as const,
          message: testResult.error || 'WordPress接続に失敗しました',
          wpType: context.wpSettings.wpType,
          lastUpdated: context.wpSettings.updatedAt ?? null,
        },
      };
    }

    return {
      success: true,
      data: {
        connected: true,
        status: 'connected' as const,
        message: `WordPress (${context.wpSettings.wpType === 'wordpress_com' ? 'WordPress.com' : 'セルフホスト'}) に接続済み`,
        wpType: context.wpSettings.wpType,
        lastUpdated: context.wpSettings.updatedAt ?? null,
      },
    };
  });
}

/**
 * コンテンツ注釈を直接削除（孤立したコンテンツの削除用）
 */
export async function deleteContentAnnotation(
  annotationId: string
): Promise<{ success: boolean; error?: string }> {
  return withAuth(async ({ userId, ownerUserId, viewModeRole }) => {
    if (await isViewModeEnabled(viewModeRole ?? null)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }
    const targetUserId = ownerUserId || userId;
    const result = await supabaseService.deleteContentAnnotation(annotationId, targetUserId);

    if (!result.success) {
      return {
        success: false,
        error: result.error.userMessage || ERROR_MESSAGES.WORDPRESS.CONTENT_DELETE_FAILED,
      };
    }
    return { success: true };
  });
}
