import { stripHtml } from '@/lib/utils';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  buildWordPressServiceFromSettings,
  WPCOM_TOKEN_COOKIE_NAME,
} from '@/server/services/wordpressContext';
import { WordPressService } from '@/server/services/wordpressService';
import { countImageTags } from '@/lib/content-text';

export interface WpPostContentFields {
  contentText: string | null;
  contentHtml: string | null;
  title: string | null;
  excerpt: string | null;
  imageCount: number | null;
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
    imageCount: countImageTags(contentHtml),
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

/**
 * **Cookie 無しで**本文取得に使えるアクセストークンを解決できるかを判定する（真偽値）。
 *
 * AI要約一括のバックグラウンド実行が、1起動につき1回だけ呼ぶ
 * （docs/plans/content-annotation-bulk-summary-background-spec.md §9「本文取得の可否判定」）。
 * 判定ロジックを cron 側へ複製しないためにここから export する。
 *
 * WordPress 設定を取得できない2ケースは**逆向きに倒す**:
 * - **設定行が無い（クエリは成功）→ `false`（不可）**。連携していない／連携情報が消えた状態で、
 *   `/setup/wordpress` からの再連携が正しい次アクションだから。
 * - **クエリがエラー（DBの一時障害など）→ `true`（可）**。原因が連携状態だと確認できていないのに
 *   「再連携してください」と案内すると、連携が正常な利用者へ誤った次アクションを送る。
 *   判定材料が得られないときは断定の弱い既存コード（`SUMMARY_CONTENT_FETCH_FAILED`）へ落とす。
 *
 * 既知の限界: 保存済みトークンが解決できるのに WordPress 側では無効（失効済みなのに
 * `wp_token_expires_at` が NULL / 未来日）なケースは `true` になる。ここまで出し分けるには
 * `fetchWpPostContentLive` の戻り値契約（失敗を一律 `null`）を変える必要があり、親機能へ波及する。
 */
export async function canFetchWpPostContentLive(userId: string): Promise<boolean> {
  const supabase = new SupabaseService();
  const settingsResult = await supabase.getWordPressSettingsResultByUserId(userId);

  if (!settingsResult.success) {
    return true;
  }

  const wpSettings = settingsResult.data;
  if (!wpSettings) {
    return false;
  }

  if (wpSettings.wpType === 'self_hosted') {
    return buildWordPressServiceFromSettings(wpSettings, () => undefined).success;
  }

  const accessToken = await refreshWpComAccessToken(userId, supabase, wpSettings);
  return Boolean(accessToken);
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
  if (!fields.contentText?.trim() && !fields.excerpt?.trim() && !fields.title?.trim()) {
    return;
  }
  const client = supabase.getClient();
  // 本文キャッシュの書き込みは best-effort。失敗しても取得済みの本文は返すが、
  // Supabase の error は reject されないため明示的に拾ってログする。
  const { error } = await client
    .from('content_annotations')
    .update({
      wp_content_text: fields.contentText,
      wp_excerpt: fields.excerpt ?? null,
      wp_image_count: fields.imageCount,
      ...(fields.title ? { wp_post_title: fields.title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('wp_post_id', wpPostId);

  if (error) {
    console.error('[WordPressContentSync] updateContentCache failed', {
      userId,
      wpPostId,
      code: error.code,
      message: error.message,
    });
  }
}

export async function fetchWpPostContentWithCache(params: {
  wpPostId: number | null;
  cachedContent: string | null;
  cachedExcerpt: string | null;
  /**
   * `content_annotations.wp_image_count`。NULL は「画像点数を一度も取得していない」を意味するため
   * 再取得の条件に含める。含めないと本文キャッシュ済みの記事が永久に NULL のまま残る。
   */
  cachedImageCount: number | null;
  userId: string;
}): Promise<Omit<WpPostContentFields, 'contentHtml'> | null> {
  const { wpPostId, cachedContent, cachedExcerpt, cachedImageCount, userId } = params;
  const needsFetch =
    !cachedContent ||
    cachedContent.trim().length === 0 ||
    !cachedExcerpt ||
    cachedExcerpt.trim().length === 0 ||
    cachedImageCount === null;

  if (!wpPostId) {
    return needsFetch
      ? null
      : { contentText: cachedContent, title: null, excerpt: cachedExcerpt, imageCount: cachedImageCount };
  }

  if (!needsFetch) {
    return {
      contentText: cachedContent,
      title: null,
      excerpt: cachedExcerpt,
      imageCount: cachedImageCount,
    };
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
      imageCount: fields.imageCount,
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
