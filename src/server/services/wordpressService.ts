import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { countImageTags } from '@/lib/content-text';
import { stripHtml } from '@/lib/utils';
import {
  fetchPublicUrl,
  PublicUrlBlockedError,
  siteUrlRejectMessage,
  type PublicRequestInit,
} from '@/server/lib/public-url-guard';
import {
  WordPressPostResponse,
  WordPressPostApiResponse,
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

export class WordPressRestFetchError extends Error {
  constructor(message: string, readonly statuses: number[]) {
    super(message);
    this.name = 'WordPressRestFetchError';
  }
}

/** 取込の締め切りを過ぎたので、次のページの取得や次の書き込みをせずに打ち切った */
export class WordPressImportDeadlineError extends Error {
  constructor() {
    super('WordPress import stopped at the deadline');
    this.name = 'WordPressImportDeadlineError';
  }
}

export function assertBeforeDeadline(deadlineAt: number | undefined): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) throw new WordPressImportDeadlineError();
}

// 1リクエストの応答を待つ上限。応答しないサイトで残り時間を使い切らないため
const REST_FETCH_TIMEOUT_MS = 60_000;

/**
 * 一覧の1ページが重すぎてサイト側が失敗したときに、件数を減らして取り直す段階。
 * ページビルダー（Elementor など）を使うサイトは、本文の描画が PHP の実行時間上限（30秒など）を超え、
 * 100件のページで 500 や途中で切れた応答を返す。
 */
const REDUCED_PER_PAGE_STEPS = [20, 5];

/**
 * 投稿タイプの REST の入り口がサイトに無い（設定に残っているが、プラグインを外した・REST に公開していない）。
 * そのタイプには取り込む記事が無いので、取込全体を失敗にせずに飛ばす。
 */
function isMissingRoute(error: unknown): boolean {
  return error instanceof WordPressRestFetchError &&
    error.statuses.length > 0 &&
    error.statuses.every(status => status === 404) &&
    error.message.includes('rest_no_route');
}

/**
 * 件数を減らせば通る見込みがある失敗（5xx・応答が途中で切れた・タイムアウト）か。
 * 候補 URL のどれか1つでも当てはまれば取り直す（もう一方の形式がサイトで使えず 404・403 になることがある）。
 * どの候補も認証エラーや 404 だけなら、件数を減らしても変わらない。
 */
function isHeavyPageFailure(error: unknown): boolean {
  return error instanceof WordPressRestFetchError &&
    error.statuses.some(status => status === 0 || status >= 500);
}

/** 締め切りがあれば、その時刻を越えて待たない */
function restFetchSignal(deadlineAt: number | undefined): AbortSignal {
  const remaining = deadlineAt === undefined ? REST_FETCH_TIMEOUT_MS : deadlineAt - Date.now();
  return AbortSignal.timeout(Math.max(1, Math.min(REST_FETCH_TIMEOUT_MS, remaining)));
}

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
   * セルフホストは利用者が入力した URL へ接続するので、公開アドレスかどうかを毎回検査する。
   */
  private request(url: string, init?: PublicRequestInit): Promise<Response> {
    return this.type === 'self_hosted' ? fetchPublicUrl(url, init) : fetch(url, init);
  }

  /**
   * セルフホスト環境で /wp-json/ が拒否される場合に、rest_route 形式へフォールバックする。
   */
  private async fetchRestResource(resource: string, signal?: AbortSignal): Promise<Response> {
    const primaryResponse = await this.request(`${this.baseUrl}/${resource}`, {
      headers: this.getAuthHeaders(),
      ...(signal ? { signal } : {}),
    });
    const isWordPressNotFound =
      primaryResponse.status === 404 &&
      primaryResponse.headers.get('content-type')?.includes('application/json');
    if (
      primaryResponse.ok ||
      isWordPressNotFound ||
      this.type !== 'self_hosted' ||
      !this.siteUrl
    ) {
      return primaryResponse;
    }

    const [pathname, query = ''] = resource.split('?', 2);
    const fallbackUrl = `${this.siteUrl.replace(/\/$/, '')}/index.php?rest_route=/wp/v2/${pathname}${query ? `&${query}` : ''}`;
    console.warn('[WordPressService] REST API primary request failed; trying fallback', {
      status: primaryResponse.status,
      resource: pathname,
    });
    return this.request(fallbackUrl, {
      headers: this.getAuthHeaders(),
      ...(signal ? { signal } : {}),
    });
  }

  private async getRestErrorMessage(response: Response): Promise<string> {
    if (response.status === 401 || response.status === 403) {
      return ERROR_MESSAGES.WORDPRESS.REST_API_ACCESS_DENIED;
    }

    const errorBody: unknown = await response.json().catch(() => null);
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string'
    ) {
      return errorBody.message;
    }
    return response.statusText;
  }

  /**
   * 統合接続テスト（WordPress.comとセルフホスト両対応）
   */
  async testConnection(): Promise<WordPressApiResult<WordPressSiteInfo>> {
    try {
      let response: Response;

      if (this.type === 'wordpress_com') {
        // WordPress.com用：v1.1 APIを使用
        response = await this.request(`https://public-api.wordpress.com/rest/v1.1/sites/${this.siteId}`, {
          headers: this.getAuthHeaders(),
        });
      } else {
        // セルフホスト用：段階テスト（到達 -> 認証 -> 権限）
        // 1) 到達確認
        const rootUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/wp-json/`;
        const reachabilityResp = await this.request(rootUrl, {
          headers: { Accept: 'application/json', 'User-Agent': 'IndustrySpecificMC/1.0 (+app)' },
        });
        if (!reachabilityResp.ok) {
          // Xserver等で /wp-json/ がブロックされる場合のフォールバック
          const altRoot = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/`;
          const altResp = await this.request(altRoot, {
            headers: { Accept: 'application/json', 'User-Agent': 'IndustrySpecificMC/1.0 (+app)' },
          });
          if (!altResp.ok) {
            return this.testConnectionStageFailure('reachability', reachabilityResp, altResp);
          }
        }

        // 2) 認証確認（ユーザー情報取得）
        const authResp = await this.request(`${this.baseUrl}/users/me`, {
          headers: this.getAuthHeaders(),
        });
        if (!authResp.ok) {
          // フォールバック: index.php?rest_route=
          const altAuthUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/wp/v2/users/me`;
          const altAuthResp = await this.request(altAuthUrl, { headers: this.getAuthHeaders() });
          if (!altAuthResp.ok) {
            const stage =
              authResp.status === 401 || altAuthResp.status === 401
                ? 'authentication'
                : 'auth_or_waf';
            return this.testConnectionStageFailure(stage, authResp, altAuthResp);
          }
        }

        // 3) 権限確認（設定エンドポイント）
        response = await this.request(`${this.baseUrl}/settings`, {
          headers: this.getAuthHeaders(),
        });
        if (!response.ok) {
          // フォールバック: index.php?rest_route=
          const altSettingsUrl = `${(this.siteUrl || '').replace(/\/$/, '')}/index.php?rest_route=/wp/v2/settings`;
          const altSettingsResp = await this.request(altSettingsUrl, { headers: this.getAuthHeaders() });
          if (!altSettingsResp.ok) {
            return this.testConnectionStageFailure('permission_or_waf', response, altSettingsResp);
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
      if (error instanceof PublicUrlBlockedError) {
        return { success: false, error: siteUrlRejectMessage(error.reason) };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.WORDPRESS.TEST_CONNECTION_UNEXPECTED,
      };
    }
  }

  /**
   * 利用者が入力した URL の応答本文は画面へ返さず（内部サーバーの応答を読み出す SSRF の出口になる）、ログにだけ残す。
   */
  private async testConnectionStageFailure(
    stage: string,
    primary: Response,
    fallback: Response
  ): Promise<WordPressApiResult<WordPressSiteInfo>> {
    const [primaryBody, fallbackBody] = await Promise.all([
      primary.text().catch(() => ''),
      fallback.text().catch(() => ''),
    ]);
    console.error('[WordPressService] testConnection failed', {
      stage,
      primaryStatus: primary.status,
      fallbackStatus: fallback.status,
      primaryBody: primaryBody.slice(0, 500),
      fallbackBody: fallbackBody.slice(0, 500),
    });
    return {
      success: false,
      error: `[${stage}] HTTP ${`${primary.status} ${primary.statusText}`.trim()} | alt HTTP ${`${fallback.status} ${fallback.statusText}`.trim()}`,
    };
  }

  /**
   * スラッグで既存コンテンツ (投稿または固定ページ) を検索（WordPress.comとセルフホスト両対応）
   */
  async findExistingContent(
    slug: string,
    type: 'posts' | 'pages' = 'posts',
    signal?: AbortSignal
  ): Promise<WordPressApiResult<WordPressPostResponse | null>> {
    try {
      const response = await this.fetchRestResource(
        `${type}?slug=${encodeURIComponent(slug)}`,
        signal
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, data: null }; // Not found is not an error here
        }
        return {
          success: false,
          error: `${type === 'pages' ? '固定ページ' : '投稿'}検索エラー (${slug}): ${await this.getRestErrorMessage(response)}`,
        };
      }

      const rawItems: unknown = await response.json();
      const items = Array.isArray(rawItems)
        ? rawItems
            .map(item => normalizeWordPressPostResponse(item))
            .filter((item): item is WordPressPostResponse => item !== null)
        : [];
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
      if (signal?.aborted) throw error;
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
  async resolveContentById(
    id: number,
    signal?: AbortSignal
  ): Promise<WordPressApiResult<WordPressPostResponse | null>> {
    const tryFetch = async (
      type: 'posts' | 'pages'
    ): Promise<WordPressApiResult<WordPressPostResponse | null>> => {
      try {
        const response = await this.fetchRestResource(`${type}/${id}?_embed=true`, signal);

        if (!response.ok) {
          if (response.status === 404) {
            return { success: true, data: null };
          }
          return {
            success: false,
            error: `${type === 'pages' ? '固定ページ' : '投稿'}取得エラー (${id}): ${await this.getRestErrorMessage(response)}`,
          };
        }

        const item = normalizeWordPressPostResponse(await response.json());
        if (!item) {
          return { success: false, error: ERROR_MESSAGES.WORDPRESS.POSTS_FETCH_FAILED };
        }
        return { success: true, data: item };
      } catch (error) {
        if (signal?.aborted) throw error;
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

  public fetchRestPath(resource: string): Promise<Response> {
    return this.request(`${this.baseUrl}/${resource}`, { headers: this.getAuthHeaders() });
  }

  public async fetchAvailableContentTypes(deadlineAt?: number): Promise<WordPressApiResult<string[]>> {
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
      assertBeforeDeadline(deadlineAt);
      try {
        const response = await this.request(url, { headers, cache: 'no-store', signal: restFetchSignal(deadlineAt) });
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

    // 締め切りで応答待ちを打ち切った場合は、取得の失敗ではなく締め切りとして返す
    assertBeforeDeadline(deadlineAt);
    const message = `[WordPressService] 投稿タイプの取得に失敗しました: HTTP ${lastStatus} ${lastErrorText}`.trim();
    return {
      success: false,
      error: message,
    };
  }

  public buildRestQueryParams(
    options: { perPage: number; page: number; status?: string; embed?: boolean; modifiedAfter?: string; after?: string }
  ): string {
    const params = new URLSearchParams();
    params.set('per_page', String(options.perPage));
    params.set('page', String(options.page));
    params.set('status', options.status ?? 'publish');
    // 既定の post_date 順は同日時の記事がページ間で入れ替わり、page 送りで取りこぼすため一意な id で固定する
    params.set('orderby', 'id');
    params.set('order', 'asc');
    if (options.embed !== false) {
      params.set('_embed', 'true');
    }
    if (options.modifiedAfter !== undefined) params.set('modified_after', options.modifiedAfter);
    if (options.after !== undefined) params.set('after', options.after);
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
    options: { status?: string; embed?: boolean; modifiedAfter?: string; after?: string; deadlineAt?: number } = {}
  ): Promise<{ posts: WordPressRestPost[]; total: number }> {
    const queryOptions: { perPage: number; page: number; status?: string; embed?: boolean; modifiedAfter?: string; after?: string } = {
      perPage,
      page,
    };
    if (options.status !== undefined) {
      queryOptions.status = options.status;
    }
    if (options.embed !== undefined) {
      queryOptions.embed = options.embed;
    }
    if (options.modifiedAfter !== undefined) queryOptions.modifiedAfter = options.modifiedAfter;
    if (options.after !== undefined) queryOptions.after = options.after;

    const params = this.buildRestQueryParams(queryOptions);
    const { headers, urls } = this.buildRestFetchCandidates(postType, params);

    const statuses: number[] = [];
    let lastStatus = 0;
    let lastErrorText = '';

    for (const url of urls) {
      assertBeforeDeadline(options.deadlineAt);
      try {
        const resp = await this.request(url, { headers, cache: 'no-store', signal: restFetchSignal(options.deadlineAt) });
        if (!resp.ok) {
          statuses.push(resp.status);
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
        statuses.push(0);
        lastStatus = lastStatus || 0;
        lastErrorText = error instanceof Error ? error.message : 'Unknown fetch error';
      }
    }

    // 締め切りで応答待ちを打ち切った場合は、取得の失敗ではなく締め切りとして返す
    assertBeforeDeadline(options.deadlineAt);
    throw new WordPressRestFetchError(
      `[WordPressService] Failed to fetch ${postType}: HTTP ${lastStatus} ${lastErrorText}`.trim(),
      statuses
    );
  }

  public async fetchAllContentByTypes(
    postTypes: string[],
    options: FetchAllContentOptions = {}
  ): Promise<FetchAllContentResult<WordPressRestPost>> {
    return this.collectContentByTypes(postTypes, options, posts => posts);
  }

  /**
   * 全件取得をページごとに正規化して集める。生の記事（本文HTML・_embedded・yoast_head）を
   * 全ページ分保持すると1万件超のサイトで数百MB〜1GB規模になるため、ページを受け取るたびに落とす。
   */
  public async fetchAllNormalizedContentByTypes(
    postTypes: string[],
    options: FetchAllContentOptions = {}
  ): Promise<FetchAllContentResult<WordPressNormalizedPost>> {
    return this.collectContentByTypes(postTypes, options, posts => normalizeWordPressRestPosts(posts));
  }

  private async collectContentByTypes<T>(
    postTypes: string[],
    options: FetchAllContentOptions,
    mapPage: (posts: WordPressRestPost[]) => T[]
  ): Promise<FetchAllContentResult<T>> {
    const initialPerPage = Math.min(options.perPage ?? 100, 100);
    const status = options.status ?? 'publish';

    const aggregated: T[] = [];
    const totalsByType: Record<string, number> = {};
    const uniqueIdCountsByType: Record<string, number> = {};
    const missingRouteTypes: string[] = [];

    for (const postTypeRaw of postTypes) {
      const postType = postTypeRaw && postTypeRaw.trim() ? postTypeRaw.trim() : 'posts';
      const normalizedType = normalizeContentType(postType);
      let page = 1;
      let perPage = initialPerPage;
      let fetchedForType = 0;
      let totalForType = 0;
      let hasMore = true;
      const idsForType = new Set<string>();

      while (hasMore) {
        assertBeforeDeadline(options.deadlineAt);
        let result: { posts: WordPressRestPost[]; total: number };
        try {
          result = await this.fetchRestCollection(normalizedType, page, perPage, {
            status,
            ...(options.modifiedAfter ? { modifiedAfter: options.modifiedAfter } : {}),
            ...(options.after ? { after: options.after } : {}),
            ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
          });
        } catch (error) {
          if (page === 1 && isMissingRoute(error)) {
            console.warn('[WordPressService] content type has no REST route; skipped', { postType: normalizedType });
            missingRouteTypes.push(normalizedType);
            break;
          }
          const smaller = REDUCED_PER_PAGE_STEPS.find(size => size < perPage && perPage % size === 0);
          if (smaller === undefined || !isHeavyPageFailure(error)) throw error;
          // 取れていない位置（offset）から、小さいページで続きを取る
          page = ((page - 1) * perPage) / smaller + 1;
          perPage = smaller;
          continue;
        }
        const { posts, total } = result;
        totalForType = total;
        aggregated.push(...mapPage(posts));
        for (const post of posts) {
          const id = post.id ?? post.ID;
          if (id !== undefined && id !== null) idsForType.add(String(id));
        }
        fetchedForType += posts.length;
        hasMore = fetchedForType < total && posts.length === perPage;
        page += 1;
      }

      totalsByType[normalizedType] = totalForType;
      uniqueIdCountsByType[normalizedType] = idsForType.size;

    }

    return { posts: aggregated, totalsByType, uniqueIdCountsByType, missingRouteTypes };
  }
}

type FetchAllContentOptions = {
  perPage?: number;
  status?: string;
  modifiedAfter?: string;
  after?: string;
  /** epoch ms。各ページを取る前に確かめ、過ぎていたら WordPressImportDeadlineError */
  deadlineAt?: number;
};

type FetchAllContentResult<T> = {
  posts: T[];
  totalsByType: Record<string, number>;
  /** 要求した投稿タイプ（REST のパス名）ごとの、重複を除いた記事 ID の数。totalsByType と同じキー */
  uniqueIdCountsByType: Record<string, number>;
  /** REST の入り口がサイトに無く、飛ばした投稿タイプ */
  missingRouteTypes: string[];
};

function normalizeWordPressPostResponse(data: unknown): WordPressPostResponse | null {
  if (!data || typeof data !== 'object') return null;

  const raw = data as WordPressPostApiResponse;
  const postId = raw.id ?? raw.ID;
  if (typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId <= 0) {
    return null;
  }

  const normalized: Record<string, unknown> = {
    ...(raw as unknown as Record<string, unknown>),
    id: postId,
  };
  delete normalized.ID;
  return normalized as unknown as WordPressPostResponse;
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

    // 一覧レスポンスには content.rendered が含まれる（_fields で絞っていない）。
    // ここで平文と img タグ数まで落としておくことで、記事本文HTMLを配列に保持せずに
    // wp_content_text / wp_image_count を一括インポートで埋められる。
    const contentHtml = resolveRenderedField(post.content);
    if (contentHtml !== undefined) {
      const contentText = stripHtml(contentHtml).trim();
      if (contentText) {
        normalized.content_text = contentText;
      }
      normalized.image_count = countImageTags(contentHtml);
    }

    const postType = post.type ?? defaultType;
    if (postType !== undefined) {
      normalized.post_type = normalizeContentType(postType);
    }

    return normalized;
  });
}
