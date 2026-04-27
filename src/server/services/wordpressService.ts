import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  WordPressPostResponse,
  WordPressSiteInfo,
  WordPressApiResult,
  WordPressType,
  WordPressRestPost,
  WordPressNormalizedPost,
  WordPressRenderedField,
  WordPressRestTerm,
} from '@/types/wordpress';
import {
  normalizeContentType,
  BLOCKED_WORDPRESS_CONTENT_TYPES,
} from '@/server/services/wordpressContentTypes';

// WordPress.com認証情報
interface WordPressComAuth {
  accessToken: string;
  siteId: string; // This can be the site domain or the numeric site ID
}

// セルフホストWordPress認証情報
interface SelfHostedAuth {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}

// 統合認証情報
export interface WordPressAuth {
  type: WordPressType;
  wpComAuth?: WordPressComAuth;
  selfHostedAuth?: SelfHostedAuth;
}

export class WordPressService {
  private type: WordPressType;
  private accessToken?: string;
  private siteId?: string;
  private siteUrl?: string;
  private username?: string;
  private applicationPassword?: string;
  private baseUrl: string;

  // 後方互換性のため、既存のWordPress.com用コンストラクタを維持
  constructor(auth: WordPressComAuth);
  // 新しい統合認証用コンストラクタ
  constructor(auth: WordPressAuth);
  constructor(auth: WordPressComAuth | WordPressAuth) {
    if ('type' in auth) {
      // 新しい統合認証
      this.type = auth.type;
      if (auth.type === 'wordpress_com' && auth.wpComAuth) {
        this.accessToken = auth.wpComAuth.accessToken;
        this.siteId = auth.wpComAuth.siteId;
        this.baseUrl = `https://public-api.wordpress.com/wp/v2/sites/${this.siteId}`;
      } else if (auth.type === 'self_hosted' && auth.selfHostedAuth) {
        this.siteUrl = auth.selfHostedAuth.siteUrl;
        this.username = auth.selfHostedAuth.username;
        this.applicationPassword = auth.selfHostedAuth.applicationPassword;
        this.baseUrl = `${this.siteUrl.replace(/\/$/, '')}/wp-json/wp/v2`;
      } else {
        throw new Error('Invalid authentication configuration');
      }
    } else {
      // 既存のWordPress.com用認証（後方互換性）
      this.type = 'wordpress_com';
      this.accessToken = auth.accessToken;
      this.siteId = auth.siteId;
      this.baseUrl = `https://public-api.wordpress.com/wp/v2/sites/${this.siteId}`;
    }
  }

  /**
   * 認証ヘッダーを取得
   */
  private getAuthHeaders(): Record<string, string> {
    const commonHeaders: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'IndustrySpecificMC/1.0 (+app)',
    };

    if (this.type === 'wordpress_com') {
      return {
        ...commonHeaders,
        Authorization: `Bearer ${this.accessToken}`,
      };
    } else {
      // セルフホスト版：Basic認証
      const credentials = btoa(`${this.username}:${this.applicationPassword}`);
      return {
        ...commonHeaders,
        Authorization: `Basic ${credentials}`,
      };
    }
  }

  /**
   * 統合接続テスト（WordPress.comとセルフホスト両対応）
   */
  async testConnection(): Promise<WordPressApiResult<WordPressSiteInfo>> {
    try {
      let response: Response;

      if (this.type === 'wordpress_com') {
        // WordPress.com用：v1.1 APIを使用
        response = await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${this.siteId}`, {
          headers: this.getAuthHeaders(),
        });
      } else {
        // セルフホスト用：段階テスト（到達 -> 認証 -> 権限）
        // 1) 到達確認
        const rootUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/wp-json/`;
        const reachabilityResp = await fetch(rootUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'IndustrySpecificMC/1.0 (+app)' },
        });
        if (!reachabilityResp.ok) {
          // Xserver等で /wp-json/ がブロックされる場合のフォールバック
          const altRoot = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/`;
          const altResp = await fetch(altRoot, {
            headers: { Accept: 'application/json', 'User-Agent': 'IndustrySpecificMC/1.0 (+app)' },
          });
          if (!altResp.ok) {
            const bodyText = await reachabilityResp.text().catch(() => reachabilityResp.statusText);
            const altText = await altResp.text().catch(() => altResp.statusText);
            return {
              success: false,
              error: `[reachability] HTTP ${reachabilityResp.status}: ${bodyText || reachabilityResp.statusText} | alt HTTP ${altResp.status}: ${altText || altResp.statusText}`,
            };
          }
        }

        // 2) 認証確認（ユーザー情報取得）
        const authResp = await fetch(`${this.baseUrl}/users/me`, {
          headers: this.getAuthHeaders(),
        });
        if (!authResp.ok) {
          // フォールバック: index.php?rest_route=
          const altAuthUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/wp/v2/users/me`;
          const altAuthResp = await fetch(altAuthUrl, { headers: this.getAuthHeaders() });
          if (!altAuthResp.ok) {
            const authErrBody = await authResp.text().catch(() => authResp.statusText);
            const altAuthBody = await altAuthResp.text().catch(() => altAuthResp.statusText);
            const stage =
              authResp.status === 401 || altAuthResp.status === 401
                ? 'authentication'
                : 'auth_or_waf';
            return {
              success: false,
              error: `[${stage}] HTTP ${authResp.status}: ${authErrBody || authResp.statusText} | alt HTTP ${altAuthResp.status}: ${altAuthBody || altAuthResp.statusText}`,
            };
          }
        }

        // 3) 権限確認（設定エンドポイント）
        response = await fetch(`${this.baseUrl}/settings`, {
          headers: this.getAuthHeaders(),
        });
        if (!response.ok) {
          // フォールバック: index.php?rest_route=
          const altSettingsUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/wp/v2/settings`;
          const altSettingsResp = await fetch(altSettingsUrl, { headers: this.getAuthHeaders() });
          if (!altSettingsResp.ok) {
            const bodyText = await response.text().catch(() => response.statusText);
            const altText = await altSettingsResp.text().catch(() => altSettingsResp.statusText);
            return {
              success: false,
              error: `[permission_or_waf] HTTP ${response.status}: ${bodyText || response.statusText} | alt HTTP ${altSettingsResp.status}: ${altText || altSettingsResp.statusText}`,
            };
          }
          // フォールバック成功時は以降の処理で altSettingsResp を使う
          response = altSettingsResp as unknown as Response;
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorBody.message || response.statusText}`,
        };
      }

      const siteData = await response.json();

      if (this.type === 'wordpress_com') {
        return {
          success: true,
          data: {
            name: siteData.name || siteData.title,
            url: siteData.URL || siteData.url,
            description: siteData.description,
          },
        };
      } else {
        // セルフホスト版の場合、設定からサイト情報を取得
        return {
          success: true,
          data: {
            name: siteData.title || 'WordPress Site',
            url: this.siteUrl || '',
            description: siteData.description || '',
          },
        };
      }
    } catch (error) {
      console.error('Error in testConnection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.WORDPRESS.TEST_CONNECTION_UNEXPECTED,
      };
    }
  }

  /**
   * スラッグで既存コンテンツ (投稿または固定ページ) を検索（WordPress.comとセルフホスト両対応）
   */
  async findExistingContent(
    slug: string,
    type: 'posts' | 'pages' = 'posts'
  ): Promise<WordPressApiResult<WordPressPostResponse | null>> {
    try {
      const endpoint = `${this.baseUrl}/${type}?slug=${encodeURIComponent(slug)}`;
      const response = await fetch(endpoint, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, data: null }; // Not found is not an error here
        }
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        return {
          success: false,
          error: `${type === 'pages' ? '固定ページ' : '投稿'}検索エラー (${slug}): ${errorBody.message || response.statusText}`,
        };
      }

      const items: WordPressPostResponse[] = await response.json();
      let resultData: WordPressPostResponse | null = null;

      const exactMatch = items.find(item => item.slug === slug);

      if (exactMatch) {
        resultData = exactMatch;
      } else if (items && items.length > 0 && items[0] !== undefined) {
        resultData = items[0];
      }

      return {
        success: true,
        data: resultData,
      };
    } catch (error) {
      console.error(`Error in findExistingContent for slug ${slug} (type: ${type}):`, error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : `Unknown error during findExistingContent for ${slug} (type: ${type})`,
      };
    }
  }

  /**
   * 投稿IDからコンテンツ詳細を取得（投稿→固定ページの順で検索）
   */
  async resolveContentById(id: number): Promise<WordPressApiResult<WordPressPostResponse | null>> {
    const tryFetch = async (
      type: 'posts' | 'pages'
    ): Promise<WordPressApiResult<WordPressPostResponse | null>> => {
      try {
        const endpoint = `${this.baseUrl}/${type}/${id}?_embed=true`;
        const response = await fetch(endpoint, { headers: this.getAuthHeaders() });

        if (!response.ok) {
          if (response.status === 404) {
            return { success: true, data: null };
          }
          const errorBody = await response.json().catch(() => ({ message: response.statusText }));
          return {
            success: false,
            error: `${type === 'pages' ? '固定ページ' : '投稿'}取得エラー (${id}): ${errorBody.message || response.statusText}`,
          };
        }

        const item: WordPressPostResponse = await response.json();
        return { success: true, data: item };
      } catch (error) {
        console.error(`Error in getContentById for id ${id} (type: ${type}):`, error);
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : `Unknown error during getContentById for ${id} (type: ${type})`,
        };
      }
    };

    const postResult = await tryFetch('posts');
    if (!postResult.success) {
      return postResult;
    }
    if (postResult.data) {
      return postResult;
    }

    const pageResult = await tryFetch('pages');
    return pageResult;
  }

  /**
   * REST API 呼び出し向けの共通ヘッダーを取得
   */
  public getRestHeaders(): Record<string, string> {
    return this.getAuthHeaders();
  }

  /**
   * REST API ベースURLを取得
   */
  public getRestBaseUrl(): string {
    return this.baseUrl;
  }

  public getAuthType(): WordPressType {
    return this.type;
  }

  public getSelfHostedSiteUrl(): string | undefined {
    return this.siteUrl;
  }

  public getWordPressComSiteId(): string | undefined {
    return this.siteId;
  }

  public async fetchAvailableContentTypes(): Promise<WordPressApiResult<string[]>> {
    const headers = this.getRestHeaders();
    const urls = new Set<string>();

    urls.add(`${this.baseUrl}/types`);

    if (this.type === 'self_hosted' && this.siteUrl) {
      const siteClean = this.siteUrl.replace(/\/$/, '');
      urls.add(`${siteClean}/wp-json/wp/v2/types`);
      urls.add(`${siteClean}/index.php?rest_route=/wp/v2/types`);
    }

    let lastStatus = 0;
    let lastErrorText = '';

    for (const url of urls) {
      try {
        const response = await fetch(url, { headers, cache: 'no-store' });
        if (!response.ok) {
          lastStatus = response.status;
          lastErrorText = await response.text().catch(() => response.statusText);
          continue;
        }

        const data = await response.json();
        if (data && typeof data === 'object') {
          const entries = data as Record<
            string,
            {
              rest_base?: string;
              slug?: string;
              viewable?: boolean;
              show_in_rest?: boolean;
            }
          >;

          const restBases = new Set<string>();

          Object.entries(entries).forEach(([slug, entry]) => {
            if (!entry || typeof entry !== 'object') {
              return;
            }

            const showInRest =
              typeof entry.show_in_rest === 'boolean' ? entry.show_in_rest : true;
            if (!showInRest) {
              return;
            }

            const isViewable = typeof entry.viewable === 'boolean' ? entry.viewable : true;
            if (!isViewable) {
              return;
            }

            const restBase =
              typeof entry.rest_base === 'string' && entry.rest_base.trim().length > 0
                ? entry.rest_base.trim()
                : slug;

            const normalized = normalizeContentType(restBase);
            const normalizedLower = normalized.toLowerCase();
            const slugLower = slug.toLowerCase();
            if (
              BLOCKED_WORDPRESS_CONTENT_TYPES.has(normalizedLower) ||
              BLOCKED_WORDPRESS_CONTENT_TYPES.has(slugLower)
            ) {
              return;
            }
            if (
              normalizedLower.startsWith('wp_') ||
              normalizedLower.startsWith('wp-') ||
              slugLower.startsWith('wp_') ||
              slugLower.startsWith('wp-')
            ) {
              return;
            }
            if (
              normalizedLower.startsWith('jp_') ||
              normalizedLower.startsWith('jp-') ||
              slugLower.startsWith('jp_') ||
              slugLower.startsWith('jp-')
            ) {
              return;
            }

            restBases.add(normalized);
          });

          if (restBases.size > 0) {
            return { success: true, data: Array.from(restBases) };
          }
        }
      } catch (error) {
        lastStatus = lastStatus || 0;
        lastErrorText = error instanceof Error ? error.message : 'Unknown fetch error';
      }
    }

    const message = `[WordPressService] 投稿タイプの取得に失敗しました: HTTP ${lastStatus} ${lastErrorText}`.trim();
    return {
      success: false,
      error: message,
    };
  }

  public buildRestQueryParams(
    options: { perPage: number; page: number; status?: string; embed?: boolean }
  ): string {
    const params = new URLSearchParams();
    params.set('per_page', String(options.perPage));
    params.set('page', String(options.page));
    params.set('status', options.status ?? 'publish');
    if (options.embed !== false) {
      params.set('_embed', 'true');
    }
    return params.toString();
  }

  public buildRestFetchCandidates(
    postType: string,
    params: string
  ): { headers: Record<string, string>; urls: string[] } {
    const sanitized = normalizeContentType(postType);
    const headers = this.getRestHeaders();
    const urls = new Set<string>();

    urls.add(`${this.baseUrl}/${sanitized}?${params}`);

    if (this.type === 'self_hosted' && this.siteUrl) {
      const siteClean = this.siteUrl.replace(/\/$/, '');
      urls.add(`${siteClean}/wp-json/wp/v2/${sanitized}?${params}`);
      urls.add(`${siteClean}/index.php?rest_route=/wp/v2/${sanitized}&${params}`);
    }

    return { headers, urls: Array.from(urls) };
  }

  public async fetchRestCollection(
    postType: string,
    page: number,
    perPage: number,
    options: { status?: string; embed?: boolean } = {}
  ): Promise<{ posts: WordPressRestPost[]; total: number }> {
    const queryOptions: { perPage: number; page: number; status?: string; embed?: boolean } = {
      perPage,
      page,
    };
    if (options.status !== undefined) {
      queryOptions.status = options.status;
    }
    if (options.embed !== undefined) {
      queryOptions.embed = options.embed;
    }

    const params = this.buildRestQueryParams(queryOptions);
    const { headers, urls } = this.buildRestFetchCandidates(postType, params);

    let lastStatus = 0;
    let lastErrorText = '';

    for (const url of urls) {
      try {
        const resp = await fetch(url, { headers, cache: 'no-store' });
        if (!resp.ok) {
          lastStatus = resp.status;
          lastErrorText = await resp.text().catch(() => resp.statusText);
          continue;
        }

        const postsJson: unknown = await resp.json();
        const posts: WordPressRestPost[] = Array.isArray(postsJson)
          ? (postsJson as WordPressRestPost[])
          : [];
        const totalHeader = parseInt(resp.headers.get('X-WP-Total') || '0', 10);
        const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : posts.length;

        const sanitizedType = normalizeContentType(postType);
        const normalizedPosts = posts.map(post => ({ ...post, type: post.type ?? sanitizedType }));

        return { posts: normalizedPosts, total };
      } catch (error) {
        lastStatus = lastStatus || 0;
        lastErrorText = error instanceof Error ? error.message : 'Unknown fetch error';
      }
    }

    throw new Error(
      `[WordPressService] Failed to fetch ${postType}: HTTP ${lastStatus} ${lastErrorText}`.trim()
    );
  }

  public async fetchAllContentByTypes(
    postTypes: string[],
    options: { perPage?: number; maxItems?: number; status?: string } = {}
  ): Promise<{
    posts: WordPressRestPost[];
    totalsByType: Record<string, number>;
    wasTruncated: boolean;
    maxItems: number;
  }> {
    const perPage = Math.min(options.perPage ?? 100, 100);
    const maxItems = options.maxItems ?? 1000;
    const status = options.status ?? 'publish';

    const aggregated: WordPressRestPost[] = [];
    const totalsByType: Record<string, number> = {};
    let wasTruncated = false;

    for (const postTypeRaw of postTypes) {
      const postType = postTypeRaw && postTypeRaw.trim() ? postTypeRaw.trim() : 'posts';
      const normalizedType = normalizeContentType(postType);
      let page = 1;
      let fetchedForType = 0;
      let totalForType = 0;
      let hasMore = true;

      while (hasMore && aggregated.length < maxItems) {
        const { posts, total } = await this.fetchRestCollection(normalizedType, page, perPage, {
          status,
        });
        totalForType = total;
        aggregated.push(...posts);
        fetchedForType += posts.length;
        hasMore = fetchedForType < total && posts.length === perPage;
        page += 1;
      }

      totalsByType[normalizedType] = totalForType;

      if (aggregated.length >= maxItems) {
        wasTruncated = true;
        break;
      }
    }

    return { posts: aggregated, totalsByType, wasTruncated, maxItems };
  }
}

const resolveRenderedField = (field: WordPressRenderedField): string | undefined => {
  if (typeof field === 'string') {
    return field;
  }
  if (!field) {
    return undefined;
  }
  return field.rendered;
};

export const extractCategoryNames = (
  terms: Array<WordPressRestTerm> | undefined
): string[] => {
  if (!terms || !Array.isArray(terms)) return [];
  return terms
    .filter((term): term is WordPressRestTerm & { name: string } => Boolean(term && term.name))
    .map(term => term.name as string);
};

interface NormalizeWordPressRestPostsOptions {
  defaultType?: string;
}

export function normalizeWordPressRestPosts(
  posts: WordPressRestPost[],
  options: NormalizeWordPressRestPostsOptions = {}
): WordPressNormalizedPost[] {
  const { defaultType } = options;
  return posts.map(post => {
    const termsNested = post._embedded?.['wp:term'] ?? [];
    const firstTaxonomy =
      Array.isArray(termsNested) && termsNested.length > 0 ? termsNested[0] : undefined;
    const categoryNames = extractCategoryNames(firstTaxonomy);

    const normalized: WordPressNormalizedPost = {
      id: post.id ?? post.ID,
      categoryNames,
    };

    const date = post.date ?? post.modified;
    if (date !== undefined) {
      normalized.date = date;
    }

    const title = resolveRenderedField(post.title);
    if (title !== undefined) {
      normalized.title = title;
    }

    if (post.link !== undefined) {
      normalized.link = post.link;
    }

    const canonical = post.yoast_head_json?.canonical ?? post.link;
    if (canonical !== undefined) {
      normalized.canonical_url = canonical;
    }

    if (post.categories !== undefined) {
      normalized.categories = post.categories;
    }

    const excerpt = resolveRenderedField(post.excerpt);
    if (excerpt !== undefined) {
      normalized.excerpt = excerpt;
    }

    const postType = post.type ?? defaultType;
    if (postType !== undefined) {
      normalized.post_type = normalizeContentType(postType);
    }

    return normalized;
  });
}
