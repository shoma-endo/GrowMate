import 'server-only';
import {
  extractInsightMetric,
  extractLatestInsightMetric,
} from '@/server/lib/instagram-insights';
import type {
  InstagramAccountInsights,
  InstagramMediaInsights,
  InstagramMediaPreview,
  InstagramProfile,
} from '@/types/instagram';

const INSTAGRAM_GRAPH_VERSION = 'v23.0';
export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
] as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_EXCHANGE_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_BASE_URL = 'https://graph.instagram.com';

const PROFILE_FIELDS = [
  'user_id',
  'username',
  'name',
  'account_type',
  'profile_picture_url',
  'biography',
  'website',
  'followers_count',
  'follows_count',
  'media_count',
].join(',');

const ACCOUNT_INSIGHT_METRICS = [
  'reach',
  'views',
  'profile_views',
  'website_clicks',
  'accounts_engaged',
  'total_interactions',
  'follower_count',
].join(',');

const MEDIA_FIELDS = [
  'id',
  'media_type',
  'media_product_type',
  'media_url',
  'thumbnail_url',
  'caption',
  'timestamp',
  'permalink',
  'like_count',
  'comments_count',
].join(',');

export interface InstagramTokenExchangeResult {
  accessToken: string;
  igUserId: string;
  expiresIn: number;
}

export interface InstagramLongLivedTokenResult {
  accessToken: string;
  expiresIn: number;
}

interface GraphMediaItem {
  id: string;
  media_type?: string | undefined;
  media_product_type: InstagramMediaPreview['mediaProductType'];
  media_url?: string | undefined;
  thumbnail_url?: string | undefined;
  caption?: string | undefined;
  timestamp?: string | undefined;
  permalink?: string | undefined;
  like_count?: number | undefined;
  comments_count?: number | undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

const SENSITIVE_URL_PARAMS = ['access_token', 'client_secret'] as const;

function redactSensitiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of SENSITIVE_URL_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return SENSITIVE_URL_PARAMS.reduce(
      (masked, param) =>
        masked.replace(new RegExp(`${param}=[^&]+`, 'gi'), `${param}=[REDACTED]`),
      url
    );
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await readResponseBody(response);
  const safeUrl = redactSensitiveUrl(response.url);
  if (!response.ok) {
    console.error('[Instagram]', {
      status: response.status,
      body,
      url: safeUrl,
    });
    throw new Error(`Instagram API error: HTTP ${response.status} ${body}`);
  }

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('Instagram API response is not an object');
  } catch (error) {
    console.error('[Instagram]', { status: response.status, body, url: safeUrl });
    throw error instanceof Error ? error : new Error('Instagram API response parse failed');
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseRequiredExpiresIn(value: unknown, context: string): number {
  const parsed = parseNumber(value);
  if (parsed == null || parsed <= 0) {
    throw new Error(`Instagram ${context} response missing or invalid expires_in`);
  }
  return parsed;
}

function parseMediaType(value: unknown): InstagramMediaPreview['mediaType'] {
  if (value === 'IMAGE' || value === 'VIDEO' || value === 'CAROUSEL_ALBUM') {
    return value;
  }
  return 'IMAGE';
}

function parseSupportedMediaProductType(
  value: unknown
): InstagramMediaPreview['mediaProductType'] | null {
  if (value === 'FEED' || value === 'REELS') {
    return value;
  }
  return null;
}

export class InstagramService {
  private readonly appId: string | undefined;
  private readonly appSecret: string | undefined;
  private readonly redirectUri: string | undefined;

  constructor() {
    this.appId = process.env.INSTAGRAM_APP_ID;
    this.appSecret = process.env.INSTAGRAM_APP_SECRET;
    this.redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  }

  private ensureCredentials(): { appId: string; appSecret: string; redirectUri: string } {
    if (!this.appId || !this.appSecret || !this.redirectUri) {
      throw new Error('Instagram OAuth credentials are not configured');
    }
    return { appId: this.appId, appSecret: this.appSecret, redirectUri: this.redirectUri };
  }

  async exchangeCodeForTokens(code: string): Promise<InstagramTokenExchangeResult> {
    const { appId, appSecret, redirectUri } = this.ensureCredentials();

    const body = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });

    const response = await fetchWithTimeout(TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const json = await parseJsonResponse(response);
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    const igUserId =
      typeof json.user_id === 'string'
        ? json.user_id
        : typeof json.user_id === 'number'
          ? String(json.user_id)
          : '';
    const expiresIn = parseRequiredExpiresIn(json.expires_in, 'token exchange');

    if (!accessToken || !igUserId) {
      throw new Error('Instagram token exchange response missing access_token or user_id');
    }

    return { accessToken, igUserId, expiresIn };
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<InstagramLongLivedTokenResult> {
    const { appSecret } = this.ensureCredentials();
    const params = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: appSecret,
      access_token: shortLivedToken,
    });

    const response = await fetchWithTimeout(`${GRAPH_BASE_URL}/access_token?${params.toString()}`, {
      method: 'GET',
    });
    const json = await parseJsonResponse(response);
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    const expiresIn = parseRequiredExpiresIn(json.expires_in, 'long-lived token exchange');

    if (!accessToken) {
      throw new Error('Instagram long-lived token exchange response missing access_token');
    }

    return { accessToken, expiresIn };
  }

  async refreshLongLivedToken(longLivedToken: string): Promise<InstagramLongLivedTokenResult> {
    const params = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: longLivedToken,
    });

    const response = await fetchWithTimeout(`${GRAPH_BASE_URL}/refresh_access_token?${params.toString()}`, {
      method: 'GET',
    });
    const json = await parseJsonResponse(response);
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    const expiresIn = parseRequiredExpiresIn(json.expires_in, 'token refresh');

    if (!accessToken) {
      throw new Error('Instagram token refresh response missing access_token');
    }

    return { accessToken, expiresIn };
  }

  async fetchProfile(accessToken: string): Promise<InstagramProfile> {
    const params = new URLSearchParams({
      fields: PROFILE_FIELDS,
      access_token: accessToken,
    });
    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me?${params.toString()}`,
      { method: 'GET' }
    );
    const json = await parseJsonResponse(response);

    const igUserId =
      typeof json.user_id === 'string'
        ? json.user_id
        : typeof json.user_id === 'number'
          ? String(json.user_id)
          : typeof json.id === 'string'
            ? json.id
            : '';

    if (!igUserId) {
      throw new Error('Instagram profile response missing user_id');
    }

    return {
      igUserId,
      username: typeof json.username === 'string' ? json.username : null,
      name: typeof json.name === 'string' ? json.name : null,
      accountType: typeof json.account_type === 'string' ? json.account_type : null,
      profilePictureUrl:
        typeof json.profile_picture_url === 'string' ? json.profile_picture_url : null,
      biography: typeof json.biography === 'string' ? json.biography : null,
      website: typeof json.website === 'string' ? json.website : null,
      followersCount: parseNumber(json.followers_count),
      followsCount: parseNumber(json.follows_count),
      mediaCount: parseNumber(json.media_count),
    };
  }

  async fetchMedia(accessToken: string, limit: number): Promise<GraphMediaItem[]> {
    const params = new URLSearchParams({
      fields: MEDIA_FIELDS,
      limit: String(limit),
      access_token: accessToken,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me/media?${params.toString()}`,
      { method: 'GET' }
    );
    const json = await parseJsonResponse(response);
    const data = Array.isArray(json.data) ? json.data : [];

    return data
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .flatMap(item => {
        const id = typeof item.id === 'string' ? item.id : '';
        const productType = parseSupportedMediaProductType(item.media_product_type);
        if (!productType) {
          const rawType = item.media_product_type;
          if (typeof rawType === 'string' && rawType.length > 0) {
            console.warn('[Instagram] Skipping unsupported media_product_type', {
              mediaId: id,
              mediaProductType: rawType,
            });
          }
          return [];
        }

        const mapped: GraphMediaItem = {
          id,
          media_product_type: productType,
        };
        if (typeof item.media_type === 'string') mapped.media_type = item.media_type;
        if (typeof item.media_url === 'string') mapped.media_url = item.media_url;
        if (typeof item.thumbnail_url === 'string') mapped.thumbnail_url = item.thumbnail_url;
        if (typeof item.caption === 'string') mapped.caption = item.caption;
        if (typeof item.timestamp === 'string') mapped.timestamp = item.timestamp;
        if (typeof item.permalink === 'string') mapped.permalink = item.permalink;
        const likeCount = parseNumber(item.like_count);
        if (likeCount != null) mapped.like_count = likeCount;
        const commentsCount = parseNumber(item.comments_count);
        if (commentsCount != null) mapped.comments_count = commentsCount;

        if (mapped.id.length > 0 && mapped.permalink && mapped.timestamp) {
          return [mapped];
        }

        return [];
      });
  }

  async fetchAccountInsights(accessToken: string): Promise<InstagramAccountInsights> {
    const params = new URLSearchParams({
      metric: ACCOUNT_INSIGHT_METRICS,
      period: 'day',
      access_token: accessToken,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me/insights?${params.toString()}`,
      { method: 'GET' }
    );
    const json = await parseJsonResponse(response);
    const values = Array.isArray(json.data) ? json.data : [];

    return {
      reach: extractLatestInsightMetric(values, 'reach'),
      views: extractLatestInsightMetric(values, 'views'),
      profileViews: extractLatestInsightMetric(values, 'profile_views'),
      websiteClicks: extractLatestInsightMetric(values, 'website_clicks'),
      accountsEngaged: extractLatestInsightMetric(values, 'accounts_engaged'),
      totalInteractions: extractLatestInsightMetric(values, 'total_interactions'),
      followerCount: extractLatestInsightMetric(values, 'follower_count'),
    };
  }

  async fetchMediaInsights(
    accessToken: string,
    mediaId: string,
    mediaProductType: InstagramMediaPreview['mediaProductType']
  ): Promise<InstagramMediaInsights> {
    const baseMetrics = [
      'reach',
      'views',
      'likes',
      'comments',
      'saved',
      'shares',
      'total_interactions',
    ];
    const reelMetrics =
      mediaProductType === 'REELS'
        ? ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time']
        : [];
    const metrics = [...baseMetrics, ...reelMetrics].join(',');

    const params = new URLSearchParams({
      metric: metrics,
      access_token: accessToken,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/${mediaId}/insights?${params.toString()}`,
      { method: 'GET' }
    );
    const json = await parseJsonResponse(response);
    const values = Array.isArray(json.data) ? json.data : [];

    return {
      reach: extractInsightMetric(values, 'reach'),
      views: extractInsightMetric(values, 'views'),
      likes: extractInsightMetric(values, 'likes'),
      comments: extractInsightMetric(values, 'comments'),
      saved: extractInsightMetric(values, 'saved'),
      shares: extractInsightMetric(values, 'shares'),
      totalInteractions: extractInsightMetric(values, 'total_interactions'),
      avgWatchTimeMs: extractInsightMetric(values, 'ig_reels_avg_watch_time'),
      totalWatchTimeMs: extractInsightMetric(values, 'ig_reels_video_view_total_time'),
    };
  }

  toMediaPreview(item: GraphMediaItem, insights: InstagramMediaInsights): InstagramMediaPreview {
    if (!item.permalink || !item.timestamp) {
      throw new Error('Instagram media item missing permalink or timestamp');
    }

    return {
      id: item.id,
      mediaType: parseMediaType(item.media_type),
      mediaProductType: item.media_product_type,
      mediaUrl: item.media_url ?? null,
      thumbnailUrl: item.thumbnail_url ?? null,
      caption: item.caption ?? null,
      timestamp: item.timestamp,
      permalink: item.permalink,
      likeCount: item.like_count ?? null,
      commentsCount: item.comments_count ?? null,
      insights,
    };
  }
}
