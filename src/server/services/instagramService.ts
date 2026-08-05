import 'server-only';
import {
  extractInsightDailySeries,
  extractInsightMetric,
} from '@/server/lib/instagram-insights';
import {
  mergeInstagramRateUsage,
  parseInstagramRateUsage,
  type InstagramRateUsage,
} from '@/server/lib/instagram-rate-limit';
import type { InstagramMediaPageResponse } from '@/server/lib/instagram-media-pagination';
import type {
  InstagramAccountInsightsDailyRow,
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
  'followers_count',
  'follows_count',
  'media_count',
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
}

export interface InstagramLongLivedTokenResult {
  accessToken: string;
  expiresIn: number;
}

export interface InstagramApiResult<T> {
  data: T;
  usage: InstagramRateUsage;
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

async function parseJsonResponse(response: Response): Promise<{
  json: Record<string, unknown>;
  usage: InstagramRateUsage;
}> {
  const body = await readResponseBody(response);
  const safeUrl = redactSensitiveUrl(response.url);
  const usage = parseInstagramRateUsage(response.headers);
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
      return { json: parsed as Record<string, unknown>, usage };
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

function unwrapDataEnvelope(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data;
  if (Array.isArray(data) && typeof data[0] === 'object' && data[0] !== null) {
    return data[0] as Record<string, unknown>;
  }
  return json;
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

export function parseInstagramMediaItems(
  rawItems: unknown[],
  options?: { logUnsupported?: boolean }
): GraphMediaItem[] {
  const logUnsupported = options?.logUnsupported !== false;
  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .flatMap(item => {
      const id = typeof item.id === 'string' ? item.id : '';
      const productType = parseSupportedMediaProductType(item.media_product_type);
      if (!productType) {
        const rawType = item.media_product_type;
        if (logUnsupported && typeof rawType === 'string' && rawType.length > 0) {
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

    const { json } = await parseJsonResponse(response);
    const payload = unwrapDataEnvelope(json);
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
    const igUserId =
      typeof payload.user_id === 'string'
        ? payload.user_id
        : typeof payload.user_id === 'number'
          ? String(payload.user_id)
          : '';

    if (!accessToken || !igUserId) {
      throw new Error('Instagram token exchange response missing access_token or user_id');
    }

    return { accessToken, igUserId };
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
    const { json } = await parseJsonResponse(response);
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
    const { json } = await parseJsonResponse(response);
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    const expiresIn = parseRequiredExpiresIn(json.expires_in, 'token refresh');

    if (!accessToken) {
      throw new Error('Instagram token refresh response missing access_token');
    }

    return { accessToken, expiresIn };
  }

  async fetchProfile(accessToken: string): Promise<InstagramApiResult<InstagramProfile>> {
    const params = new URLSearchParams({
      fields: PROFILE_FIELDS,
      access_token: accessToken,
    });
    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me?${params.toString()}`,
      { method: 'GET' }
    );
    const { json, usage } = await parseJsonResponse(response);

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
      usage,
      data: {
        igUserId,
        username: typeof json.username === 'string' ? json.username : null,
        name: typeof json.name === 'string' ? json.name : null,
        accountType: typeof json.account_type === 'string' ? json.account_type : null,
        profilePictureUrl:
          typeof json.profile_picture_url === 'string' ? json.profile_picture_url : null,
        followersCount: parseNumber(json.followers_count),
        followsCount: parseNumber(json.follows_count),
        mediaCount: parseNumber(json.media_count),
      },
    };
  }

  async fetchMediaPage(
    accessToken: string,
    options: { limit: number; after?: string | null }
  ): Promise<InstagramApiResult<InstagramMediaPageResponse>> {
    const params = new URLSearchParams({
      fields: MEDIA_FIELDS,
      limit: String(options.limit),
      access_token: accessToken,
    });
    if (options.after) {
      params.set('after', options.after);
    }

    const response = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me/media?${params.toString()}`,
      { method: 'GET' }
    );
    const { json, usage } = await parseJsonResponse(response);
    return {
      usage,
      data: {
        data: json.data,
        paging: json.paging,
      },
    };
  }

  async fetchMedia(accessToken: string, limit: number): Promise<GraphMediaItem[]> {
    const pageResult = await this.fetchMediaPage(accessToken, { limit });
    const data = Array.isArray(pageResult.data.data) ? pageResult.data.data : [];
    return parseInstagramMediaItems(data);
  }

  async fetchAccountInsightsDaily(
    accessToken: string,
    range: { since: string; until: string }
  ): Promise<InstagramApiResult<InstagramAccountInsightsDailyRow[]>> {
    const reachParams = new URLSearchParams({
      metric: 'reach',
      metric_type: 'time_series',
      period: 'day',
      since: range.since,
      until: range.until,
      access_token: accessToken,
    });
    const reachResponse = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me/insights?${reachParams.toString()}`,
      { method: 'GET' }
    );
    const reachParsed = await parseJsonResponse(reachResponse);
    const reachValues = Array.isArray(reachParsed.json.data) ? reachParsed.json.data : [];
    const reachSeries = extractInsightDailySeries(reachValues, 'reach');

    const followerParams = new URLSearchParams({
      metric: 'follower_count',
      period: 'day',
      since: range.since,
      until: range.until,
      access_token: accessToken,
    });
    const followerResponse = await fetchWithTimeout(
      `${GRAPH_BASE_URL}/${INSTAGRAM_GRAPH_VERSION}/me/insights?${followerParams.toString()}`,
      { method: 'GET' }
    );
    const followerParsed = await parseJsonResponse(followerResponse);
    const followerValues = Array.isArray(followerParsed.json.data) ? followerParsed.json.data : [];
    const followerSeries = extractInsightDailySeries(followerValues, 'follower_count');

    const byDate = new Map<string, InstagramAccountInsightsDailyRow>();

    for (const row of reachSeries) {
      const existing = byDate.get(row.date) ?? {
        date: row.date,
        reach: null,
        followerCount: null,
      };
      existing.reach = row.value;
      byDate.set(row.date, existing);
    }

    for (const row of followerSeries) {
      const existing = byDate.get(row.date) ?? {
        date: row.date,
        reach: null,
        followerCount: null,
      };
      existing.followerCount = row.value;
      byDate.set(row.date, existing);
    }

    const rows = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);

    const usage = mergeInstagramRateUsage(reachParsed.usage, followerParsed.usage);

    return { data: rows, usage };
  }

  async fetchMediaInsights(
    accessToken: string,
    mediaId: string,
    mediaProductType: InstagramMediaPreview['mediaProductType']
  ): Promise<InstagramApiResult<InstagramMediaInsights>> {
    const baseMetrics = [
      'reach',
      'views',
      'likes',
      'comments',
      'saved',
      'shares',
      'total_interactions',
      'reposts',
    ];
    const reelMetrics =
      mediaProductType === 'REELS'
        ? ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate']
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
    const { json, usage } = await parseJsonResponse(response);
    const values = Array.isArray(json.data) ? json.data : [];

    return {
      usage,
      data: {
        reach: extractInsightMetric(values, 'reach'),
        views: extractInsightMetric(values, 'views'),
        likes: extractInsightMetric(values, 'likes'),
        comments: extractInsightMetric(values, 'comments'),
        saved: extractInsightMetric(values, 'saved'),
        shares: extractInsightMetric(values, 'shares'),
        totalInteractions: extractInsightMetric(values, 'total_interactions'),
        reposts: extractInsightMetric(values, 'reposts'),
        reelsSkipRate: extractInsightMetric(values, 'reels_skip_rate'),
        avgWatchTimeMs: extractInsightMetric(values, 'ig_reels_avg_watch_time'),
        totalWatchTimeMs: extractInsightMetric(values, 'ig_reels_video_view_total_time'),
      },
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
