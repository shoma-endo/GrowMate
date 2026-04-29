/**
 * WordPress設定の種類
 */
export type WordPressType = 'wordpress_com' | 'self_hosted';

/**
 * WordPress設定（統合型）
 */
export interface WordPressSettings {
  id?: string | undefined;
  userId: string;
  wpType: WordPressType;
  // WordPress.com用
  wpClientId?: string | undefined;
  wpClientSecret?: string | undefined;
  wpSiteId?: string | undefined;
  // セルフホスト用
  wpSiteUrl?: string | undefined;
  wpUsername?: string | undefined;
  wpApplicationPassword?: string | undefined;
  // 共通（トークン）
  wpAccessToken?: string | null | undefined;
  wpRefreshToken?: string | null | undefined;
  wpTokenExpiresAt?: string | null | undefined;
  wpContentTypes?: string[] | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}

/**
 * WordPress API レスポンス (WordPress.com API v2 向け)
 */
export interface WordPressPostResponse {
  ID: number;
  link: string;
  status: string;
  title: { raw: string; rendered: string } | string;
  content: { raw: string; rendered: string } | string;
  excerpt?: { raw: string; rendered: string } | string;
  author?: { ID: number; login: string; name: string; URL: string; avatar_URL: string };
  date?: string;
  modified?: string;
  featured_image?: string;
  slug?: string;
}

/**
 * WordPress サイト情報 (WordPress.com API v1.1 向け)
 */
export interface WordPressSiteInfo {
  ID?: number;
  name: string;
  url: string; // WordPress.com APIのレスポンスは `URL` (大文字) の場合が多いので注意。サービス側でマッピングを推奨
  description?: string;
  jetpack?: boolean;
  // 他のWordPress.com APIのフィールドも必要に応じて追加
}

/**
 * API結果型
 */
export interface WordPressApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type WordPressRenderedField = { rendered?: string } | string | undefined;

export interface WordPressRestTerm {
  id?: number;
  name?: string;
}

export interface WordPressRestPost {
  id?: number;
  ID?: number;
  date?: string;
  modified?: string;
  title?: WordPressRenderedField;
  link?: string;
  categories?: number[];
  excerpt?: WordPressRenderedField;
  yoast_head_json?: {
    canonical?: string;
  };
  type?: string;
  _embedded?: {
    'wp:term'?: Array<Array<WordPressRestTerm>>;
  };
}

export interface WordPressNormalizedPost {
  id: number | string | undefined;
  date?: string;
  title?: string;
  link?: string;
  canonical_url?: string;
  categories?: number[];
  categoryNames: string[];
  excerpt?: string;
  post_type?: string;
}

interface ContentAnnotationInsert {
  user_id: string;
  wp_post_id: number | null;
  wp_post_title: string | null;
  canonical_url: string | null;
  wp_post_type: string | null;
  wp_categories: number[] | null;
  wp_category_names: string[] | null;
  wp_excerpt: string | null;
  created_at: string;
  updated_at: string;
}

interface ContentAnnotationUpdate {
  wp_post_id: number | null;
  wp_post_title: string | null;
  canonical_url: string | null;
  wp_post_type: string | null;
  wp_categories: number[] | null;
  wp_category_names: string[] | null;
  wp_excerpt: string | null;
  updated_at: string;
}

/**
 * REST APIリクエスト設定
 */
interface RestRequestConfig {
  headers: Record<string, string>;
  candidates: string[];
  siteUrlClean: string;
  isSelfHosted: boolean;
  error?: string;
}

/**
 * フェッチ候補の結果
 */
interface FetchCandidatesResult {
  resp: Response | null;
  lastStatus: number;
  lastErrorText: string;
}

/**
 * RSS正規化結果
 */
interface RssNormalizeResult {
  normalized: WordPressNormalizedPost[];
  total: number;
}

/**
 * RSSアイテム
 */
interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  categories?: string[];
}

/**
 * 正規化された投稿レスポンス
 */
export interface NormalizedPostResponse {
  id: number | null;
  link?: string;
  title?: string;
  categories?: number[];
  categoryNames?: string[];
}

/**
 * 正規URL解決パラメータ
 */
export interface ResolveCanonicalParams {
  canonicalUrl: string | null | undefined;
  supabaseService: unknown; // SupabaseService型を避けるためunknownを使用
  userId: string;
  cookieStore: unknown; // CookieStore型を避けるためunknownを使用
}

/**
 * 既存のアノテーションデータ
 */
export interface ExistingAnnotationData {
  canonical_url: string | null;
  wp_post_id: number | null;
  wp_post_title?: string | null;
}

/**
 * WordPress設定保存パラメータ
 */
export interface SaveWordPressSettingsParams {
  wpType: 'wordpress_com' | 'self_hosted';
  wpSiteId?: string;
  wpSiteUrl?: string;
  wpUsername?: string;
  wpApplicationPassword?: string;
  wpContentTypes?: string[];
}
