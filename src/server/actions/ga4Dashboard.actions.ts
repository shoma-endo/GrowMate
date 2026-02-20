'use server';

import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { normalizeToPath } from '@/lib/ga4-utils';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import type {
  Ga4DashboardSummary,
  Ga4DashboardRankingItem,
  Ga4DashboardTimeseriesPoint,
} from '@/types/ga4';

const supabaseService = new SupabaseService();

// 直近30日のデフォルト範囲を取得（JST）
const getDefaultDateRange = (): { start: string; end: string } => {
  const todayJst = formatJstDateISO(new Date());
  const end = addDaysISO(todayJst, -1);
  const start = addDaysISO(end, -29);

  return { start, end };
};

const logSupabaseError = (context: string, error: unknown) => {
  const supabaseError = error as {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  };
  console.error(context, {
    message: supabaseError?.message,
    code: supabaseError?.code,
    details: supabaseError?.details,
    hint: supabaseError?.hint,
    raw: error,
  });
};

// 日付範囲スキーマ
const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((data, ctx) => {
  const hasStart = data.start !== undefined;
  const hasEnd = data.end !== undefined;
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start/end は両方指定するか、両方省略してください',
    });
    return;
  }
  if (hasStart && hasEnd && data.start! > data.end!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start は end 以下である必要があります',
    });
  }
});

// ソートパラメータスキーマ
const rankingParamsSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  sort: z.enum(['sessions', 'cvr', 'readRate', 'avgEngagementTimeSec'] as const).default('sessions'),
}).superRefine((data, ctx) => {
  const hasStart = data.start !== undefined;
  const hasEnd = data.end !== undefined;
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start/end は両方指定するか、両方省略してください',
    });
    return;
  }
  if (hasStart && hasEnd && data.start! > data.end!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start は end 以下である必要があります',
    });
  }
});

// タイムシリーズパラメータスキーマ
const timeseriesParamsSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  normalizedPath: z.string().min(1).optional(),
}).superRefine((data, ctx) => {
  const hasStart = data.start !== undefined;
  const hasEnd = data.end !== undefined;
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start/end は両方指定するか、両方省略してください',
    });
    return;
  }
  if (hasStart && hasEnd && data.start! > data.end!) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'start は end 以下である必要があります',
    });
  }
});

interface AuthResult {
  userId: string | null;
  ownerUserId: string | null;
  role: import('@/types/user').UserRole | null;
  actorUserId?: string;
  error?: string;
}

const getAuthUserId = async (): Promise<AuthResult> => {
  const { accessToken, refreshToken } = await getLiffTokensFromCookies();
  const authResult = await authMiddleware(accessToken, refreshToken);

  if (authResult.error || !authResult.userId) {
    return {
      userId: null,
      ownerUserId: null,
      role: null,
      error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
    };
  }

  // 実行ユーザーID（View Modeの場合はオーナーIDとして実行）
  const actorUserId = authResult.userId;
  const realUserId = authResult.actorUserId || authResult.userId;
  const isViewModeAsOwner = !!authResult.actorUserId;

  return {
    userId: realUserId,
    ownerUserId: isViewModeAsOwner ? null : (authResult.ownerUserId ?? null),
    role: authResult.userDetails?.role ?? null,
    actorUserId,
  };
};

/**
 * GA4ダッシュボード: 期間サマリーを取得
 */
export async function fetchGa4DashboardSummary(input: unknown): Promise<
  ServerActionResult<Ga4DashboardSummary>
> {
  try {
    const authResult = await getAuthUserId();
    if (authResult.error || !authResult.userId) {
      return {
        success: false,
        error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      };
    }

    const { userId } = authResult;
    const client = supabaseService.getClient();

    // アクセス可能なユーザーIDを取得
    const { data: accessibleIds, error: accessError } = await client.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return { success: false, error: 'アクセス権の確認に失敗しました' };
    }

    // 日付範囲を解析
    const parsed = dateRangeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'パラメータが無効です' };
    }
    const defaultDateRange = getDefaultDateRange();
    const start = parsed.data.start ?? defaultDateRange.start;
    const end = parsed.data.end ?? defaultDateRange.end;

    // GA4プロパティが設定されているユーザーを取得
    const { data: credentials } = await client
      .from('gsc_credentials')
      .select('user_id, ga4_property_id')
      .in('user_id', accessibleIds)
      .not('ga4_property_id', 'is', null);

    if (!credentials || credentials.length === 0) {
      return {
        success: false,
        error: ERROR_MESSAGES.GA4.NOT_CONNECTED,
      };
    }

    // ORフィルタを構築
    const orFilter = credentials
      .map(
        (c) =>
          `and(user_id.eq.${c.user_id},property_id.eq."${String(c.ga4_property_id).replace(/"/g, '""')}")`
      )
      .join(',');

    // GA4データを集計
    const { data: metrics, error: metricsError } = await client
      .from('ga4_page_metrics_daily')
      .select(
        'sessions,users,engagement_time_sec,bounce_rate,cv_event_count,scroll_90_event_count,search_clicks,impressions,ctr,is_sampled,is_partial'
      )
      .or(orFilter)
      .gte('date', start)
      .lte('date', end);

    if (metricsError) {
      logSupabaseError('[GA4 Dashboard] Summary fetch failed', metricsError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    if (!metrics || metrics.length === 0) {
      return {
        success: true,
        data: {
          totalSessions: 0,
          totalUsers: 0,
          avgEngagementTimeSec: 0,
          avgBounceRate: 0,
          totalCvEventCount: 0,
          cvr: 0,
          avgReadRate: 0,
          totalSearchClicks: 0,
          totalImpressions: 0,
          ctr: null,
          hasSampledData: false,
          hasPartialData: false,
        },
      };
    }

    // 集計
    let totalSessions = 0;
    let totalUsers = 0;
    let totalEngagementTimeSec = 0;
    let bounceRateWeighted = 0;
    let bounceRateSessions = 0;
    let totalCvEventCount = 0;
    let totalScroll90EventCount = 0;
    let totalSearchClicks = 0;
    let totalImpressions = 0;
    let hasSampledData = false;
    let hasPartialData = false;

    for (const row of metrics) {
      const sessions = Number(row.sessions ?? 0);
      const users = Number(row.users ?? 0);
      const engagementTimeSec = Number(row.engagement_time_sec ?? 0);
      const bounceRate = Number(row.bounce_rate ?? 0);
      const cvEventCount = Number(row.cv_event_count ?? 0);
      const scroll90EventCount = Number(row.scroll_90_event_count ?? 0);
      const searchClicks = Number(row.search_clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);

      totalSessions += sessions;
      totalUsers += users;
      totalEngagementTimeSec += engagementTimeSec;
      totalCvEventCount += cvEventCount;
      totalScroll90EventCount += scroll90EventCount;
      totalSearchClicks += searchClicks;
      totalImpressions += impressions;

      bounceRateWeighted += bounceRate * sessions;
      bounceRateSessions += sessions;

      hasSampledData = hasSampledData || Boolean(row.is_sampled);
      hasPartialData = hasPartialData || Boolean(row.is_partial);
    }

    const avgBounceRate =
      bounceRateSessions > 0 ? bounceRateWeighted / bounceRateSessions : 0;
    const avgEngagementTimeSec =
      totalSessions > 0 ? totalEngagementTimeSec / totalSessions : 0;
    const cvr = totalUsers > 0 ? (totalCvEventCount / totalUsers) * 100 : 0;
    const avgReadRate =
      totalUsers > 0 ? (totalScroll90EventCount / totalUsers) * 100 : 0;
    const ctr = totalImpressions > 0 ? totalSearchClicks / totalImpressions : null;

    return {
      success: true,
      data: {
        totalSessions,
        totalUsers,
        avgEngagementTimeSec,
        avgBounceRate,
        totalCvEventCount,
        cvr,
        avgReadRate,
        totalSearchClicks,
        totalImpressions,
        ctr,
        hasSampledData,
        hasPartialData,
      },
    };
  } catch (error) {
    console.error('[GA4 Dashboard] Summary error:', error);
    return { success: false, error: 'サマリーの取得に失敗しました' };
  }
}

/**
 * GA4ダッシュボード: 記事別ランキングを取得
 */
export async function fetchGa4DashboardRanking(input: unknown): Promise<
  ServerActionResult<Ga4DashboardRankingItem[]>
> {
  try {
    const authResult = await getAuthUserId();
    if (authResult.error || !authResult.userId) {
      return {
        success: false,
        error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      };
    }

    const { userId } = authResult;
    const client = supabaseService.getClient();

    // アクセス可能なユーザーIDを取得
    const { data: accessibleIds, error: accessError } = await client.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return { success: false, error: 'アクセス権の確認に失敗しました' };
    }

    // パラメータを解析
    const parsed = rankingParamsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'パラメータが無効です' };
    }

    const { limit, sort } = parsed.data;
    const defaultDateRange = getDefaultDateRange();
    const dateRange = {
      start: parsed.data.start ?? defaultDateRange.start,
      end: parsed.data.end ?? defaultDateRange.end,
    };

    // GA4プロパティが設定されているユーザーを取得
    const { data: credentials } = await client
      .from('gsc_credentials')
      .select('user_id, ga4_property_id')
      .in('user_id', accessibleIds)
      .not('ga4_property_id', 'is', null);

    if (!credentials || credentials.length === 0) {
      return { success: true, data: [] };
    }

    // ORフィルタを構築
    const orFilter = credentials
      .map(
        (c) =>
          `and(user_id.eq.${c.user_id},property_id.eq."${String(c.ga4_property_id).replace(/"/g, '""')}")`
      )
      .join(',');

    // GA4データをnormalized_path単位で集計
    const { data: metrics, error: metricsError } = await client
      .from('ga4_page_metrics_daily')
      .select(
        'normalized_path,sessions,users,engagement_time_sec,bounce_rate,cv_event_count,scroll_90_event_count,search_clicks,impressions,ctr,is_sampled,is_partial'
      )
      .or(orFilter)
      .gte('date', dateRange.start)
      .lte('date', dateRange.end);

    if (metricsError) {
      logSupabaseError('[GA4 Dashboard] Ranking fetch failed', metricsError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    if (!metrics || metrics.length === 0) {
      return { success: true, data: [] };
    }

    // normalized_path単位で集計
    const aggMap = new Map<
      string,
      {
        sessions: number;
        users: number;
        engagementTimeSec: number;
        bounceRateWeighted: number;
        bounceRateSessions: number;
        cvEventCount: number;
        scroll90EventCount: number;
        searchClicks: number;
        impressions: number;
        isSampled: boolean;
        isPartial: boolean;
      }
    >();

    for (const row of metrics) {
      const normalizedPath = row.normalized_path as string;
      const current = aggMap.get(normalizedPath) ?? {
        sessions: 0,
        users: 0,
        engagementTimeSec: 0,
        bounceRateWeighted: 0,
        bounceRateSessions: 0,
        cvEventCount: 0,
        scroll90EventCount: 0,
        searchClicks: 0,
        impressions: 0,
        isSampled: false,
        isPartial: false,
      };

      const sessions = Number(row.sessions ?? 0);
      const users = Number(row.users ?? 0);
      const engagementTimeSec = Number(row.engagement_time_sec ?? 0);
      const bounceRate = Number(row.bounce_rate ?? 0);
      const cvEventCount = Number(row.cv_event_count ?? 0);
      const scroll90EventCount = Number(row.scroll_90_event_count ?? 0);
      const searchClicks = Number(row.search_clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);

      current.sessions += sessions;
      current.users += users;
      current.engagementTimeSec += engagementTimeSec;
      current.cvEventCount += cvEventCount;
      current.scroll90EventCount += scroll90EventCount;
      current.searchClicks += searchClicks;
      current.impressions += impressions;
      current.bounceRateWeighted += bounceRate * sessions;
      current.bounceRateSessions += sessions;
      current.isSampled = current.isSampled || Boolean(row.is_sampled);
      current.isPartial = current.isPartial || Boolean(row.is_partial);

      aggMap.set(normalizedPath, current);
    }

    // ランキングデータを構築
    const ranking: Ga4DashboardRankingItem[] = [];

    for (const [normalizedPath, agg] of aggMap.entries()) {
      const avgBounceRate =
        agg.bounceRateSessions > 0
          ? agg.bounceRateWeighted / agg.bounceRateSessions
          : 0;
      const cvr = agg.users > 0 ? (agg.cvEventCount / agg.users) * 100 : 0;
      const readRate =
        agg.users > 0 ? (agg.scroll90EventCount / agg.users) * 100 : 0;
      const avgEngagementTimeSec =
        agg.sessions > 0 ? agg.engagementTimeSec / agg.sessions : 0;
      const ctr = agg.impressions > 0 ? agg.searchClicks / agg.impressions : null;

      ranking.push({
        normalizedPath,
        title: null, // 後でJOINして設定
        annotationId: null, // 後でJOINして設定
        sessions: agg.sessions,
        users: agg.users,
        avgEngagementTimeSec,
        bounceRate: avgBounceRate,
        cvEventCount: agg.cvEventCount,
        cvr,
        readRate,
        searchClicks: agg.searchClicks,
        impressions: agg.impressions,
        ctr,
        isSampled: agg.isSampled,
        isPartial: agg.isPartial,
      });
    }

    // ソート
    ranking.sort((a, b) => {
      switch (sort) {
        case 'sessions':
          return b.sessions - a.sessions;
        case 'cvr':
          return b.cvr - a.cvr;
        case 'readRate':
          return b.readRate - a.readRate;
        case 'avgEngagementTimeSec':
          return b.avgEngagementTimeSec - a.avgEngagementTimeSec;
        default:
          return b.sessions - a.sessions;
      }
    });

    // タイトルとannotationIdをcontent_annotationsから取得
    const normalizedPaths = ranking.slice(0, limit).map((r) => r.normalizedPath);

    if (normalizedPaths.length > 0) {
      const { data: annotations } = await client
        .from('content_annotations')
        .select('id,canonical_url')
        .in('user_id', accessibleIds)
        .not('canonical_url', 'is', null);

      if (annotations) {
        const pathToAnnotation = new Map<string, { id: string }>();
        for (const ann of annotations) {
          if (ann.canonical_url) {
            const normalized = normalizeToPath(ann.canonical_url);
            pathToAnnotation.set(normalized, {
              id: ann.id,
            });
          }
        }

        for (const item of ranking) {
          const ann = pathToAnnotation.get(item.normalizedPath);
          if (ann) {
            item.annotationId = ann.id;
          }
        }
      }
    }

    // limitを適用
    const limitedRanking = ranking.slice(0, limit);

    return { success: true, data: limitedRanking };
  } catch (error) {
    console.error('[GA4 Dashboard] Ranking error:', error);
    return { success: false, error: 'ランキングの取得に失敗しました' };
  }
}

/**
 * GA4ダッシュボード: タイムシリーズデータを取得
 */
export async function fetchGa4DashboardTimeseries(input: unknown): Promise<
  ServerActionResult<Ga4DashboardTimeseriesPoint[]>
> {
  try {
    const authResult = await getAuthUserId();
    if (authResult.error || !authResult.userId) {
      return {
        success: false,
        error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      };
    }

    const { userId } = authResult;
    const client = supabaseService.getClient();

    // アクセス可能なユーザーIDを取得
    const { data: accessibleIds, error: accessError } = await client.rpc(
      'get_accessible_user_ids',
      { p_user_id: userId }
    );

    if (accessError || !accessibleIds) {
      return { success: false, error: 'アクセス権の確認に失敗しました' };
    }

    // パラメータを解析
    const parsed = timeseriesParamsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'パラメータが無効です' };
    }

    const { normalizedPath } = parsed.data;
    const defaultDateRange = getDefaultDateRange();
    const dateRange = {
      start: parsed.data.start ?? defaultDateRange.start,
      end: parsed.data.end ?? defaultDateRange.end,
    };

    // GA4プロパティが設定されているユーザーを取得
    const { data: credentials } = await client
      .from('gsc_credentials')
      .select('user_id, ga4_property_id')
      .in('user_id', accessibleIds)
      .not('ga4_property_id', 'is', null);

    if (!credentials || credentials.length === 0) {
      return { success: true, data: [] };
    }

    // normalizedPathが未指定の場合、期間合算のsessions Top1記事を取得
    let targetNormalizedPath = normalizedPath;

    if (!targetNormalizedPath) {
      const orFilter = credentials
        .map(
          (c) =>
            `and(user_id.eq.${c.user_id},property_id.eq."${String(c.ga4_property_id).replace(/"/g, '""')}")`
        )
        .join(',');

      const { data: topPathData } = await client
        .from('ga4_page_metrics_daily')
        .select('normalized_path,sessions')
        .or(orFilter)
        .gte('date', dateRange.start)
        .lte('date', dateRange.end);

      if (topPathData && topPathData.length > 0) {
        const sessionMap = new Map<string, number>();
        for (const row of topPathData) {
          const path = String(row.normalized_path ?? '');
          if (!path) continue;
          const sessions = Number(row.sessions ?? 0);
          sessionMap.set(path, (sessionMap.get(path) ?? 0) + sessions);
        }

        const sortedBySessions = [...sessionMap.entries()].sort(
          (a, b) => b[1] - a[1]
        );
        targetNormalizedPath = sortedBySessions[0]?.[0];
        if (!targetNormalizedPath) {
          return { success: true, data: [] };
        }
      } else {
        return { success: true, data: [] };
      }
    }

    // ORフィルタを構築
    const orFilter = credentials
      .map(
        (c) =>
          `and(user_id.eq.${c.user_id},property_id.eq."${String(c.ga4_property_id).replace(/"/g, '""')}")`
      )
      .join(',');

    // タイムシリーズデータを取得
    const { data: metrics, error: metricsError } = await client
      .from('ga4_page_metrics_daily')
      .select(
        'date,sessions,users,engagement_time_sec,bounce_rate,cv_event_count,scroll_90_event_count,search_clicks,impressions,ctr,is_sampled,is_partial'
      )
      .or(orFilter)
      .eq('normalized_path', targetNormalizedPath)
      .gte('date', dateRange.start)
      .lte('date', dateRange.end)
      .order('date', { ascending: true });

    if (metricsError) {
      logSupabaseError('[GA4 Dashboard] Timeseries fetch failed', metricsError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    if (!metrics || metrics.length === 0) {
      return { success: true, data: [] };
    }

    // 日付単位で集計してタイムシリーズを構築（複数ユーザー/複数プロパティ行を統合）
    const aggMap = new Map<
      string,
      {
        sessions: number;
        users: number;
        engagementTimeSec: number;
        bounceRateWeighted: number;
        bounceRateSessions: number;
        cvEventCount: number;
        scroll90EventCount: number;
        searchClicks: number;
        impressions: number;
        isSampled: boolean;
        isPartial: boolean;
      }
    >();

    for (const row of metrics) {
      const date = String(row.date);
      const current = aggMap.get(date) ?? {
        sessions: 0,
        users: 0,
        engagementTimeSec: 0,
        bounceRateWeighted: 0,
        bounceRateSessions: 0,
        cvEventCount: 0,
        scroll90EventCount: 0,
        searchClicks: 0,
        impressions: 0,
        isSampled: false,
        isPartial: false,
      };

      const sessions = Number(row.sessions ?? 0);
      const users = Number(row.users ?? 0);
      const engagementTimeSec = Number(row.engagement_time_sec ?? 0);
      const bounceRate = Number(row.bounce_rate ?? 0);
      const cvEventCount = Number(row.cv_event_count ?? 0);
      const scroll90EventCount = Number(row.scroll_90_event_count ?? 0);
      const searchClicks = Number(row.search_clicks ?? 0);
      const impressions = Number(row.impressions ?? 0);

      current.sessions += sessions;
      current.users += users;
      current.engagementTimeSec += engagementTimeSec;
      current.cvEventCount += cvEventCount;
      current.scroll90EventCount += scroll90EventCount;
      current.searchClicks += searchClicks;
      current.impressions += impressions;
      current.bounceRateWeighted += bounceRate * sessions;
      current.bounceRateSessions += sessions;
      current.isSampled = current.isSampled || Boolean(row.is_sampled);
      current.isPartial = current.isPartial || Boolean(row.is_partial);

      aggMap.set(date, current);
    }

    const timeseries: Ga4DashboardTimeseriesPoint[] = [...aggMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, agg]) => {
        const avgEngagementTimeSec =
          agg.sessions > 0 ? agg.engagementTimeSec / agg.sessions : 0;
        const bounceRate =
          agg.bounceRateSessions > 0
            ? agg.bounceRateWeighted / agg.bounceRateSessions
            : 0;
        const cvr = agg.users > 0 ? (agg.cvEventCount / agg.users) * 100 : 0;
        const readRate =
          agg.users > 0 ? (agg.scroll90EventCount / agg.users) * 100 : 0;
        const ctr = agg.impressions > 0 ? agg.searchClicks / agg.impressions : null;

        return {
          date,
          sessions: agg.sessions,
          users: agg.users,
          avgEngagementTimeSec,
          bounceRate,
          cvEventCount: agg.cvEventCount,
          cvr,
          readRate,
          searchClicks: agg.searchClicks,
          impressions: agg.impressions,
          ctr,
          isSampled: agg.isSampled,
          isPartial: agg.isPartial,
        };
      });

    return { success: true, data: timeseries };
  } catch (error) {
    console.error('[GA4 Dashboard] Timeseries error:', error);
    return { success: false, error: 'タイムシリーズの取得に失敗しました' };
  }
}

/**
 * GA4ダッシュボード: すべてのデータを一括取得（クライアントサイドで1回のリクエストで完結させるため）
 */
export async function fetchGa4DashboardData(input: unknown): Promise<
  ServerActionResult<{
    summary: Ga4DashboardSummary;
    ranking: Ga4DashboardRankingItem[];
    timeseries: Ga4DashboardTimeseriesPoint[];
    initialNormalizedPath?: string;
  }>
> {
  try {
    const authResult = await getAuthUserId();
    if (authResult.error || !authResult.userId) {
      return {
        success: false,
        error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      };
    }

    // パラメータを解析
    const parsedParams = dateRangeSchema.safeParse(input);
    if (!parsedParams.success) {
      return { success: false, error: 'パラメータが無効です' };
    }
    const defaultDateRange = getDefaultDateRange();
    const start = parsedParams.data.start ?? defaultDateRange.start;
    const end = parsedParams.data.end ?? defaultDateRange.end;

    // 並列でサマリー、ランキングを取得
    const [summaryResult, rankingResult] = await Promise.all([
      fetchGa4DashboardSummary({ start, end }),
      fetchGa4DashboardRanking({ start, end, limit: 100, sort: 'sessions' }),
    ]);

    if (!summaryResult.success) {
      return {
        success: false,
        error: summaryResult.error ?? 'サマリーの取得に失敗しました',
      };
    }

    if (!rankingResult.success) {
      return {
        success: false,
        error: rankingResult.error ?? 'ランキングの取得に失敗しました',
      };
    }
    if (!summaryResult.data || !rankingResult.data) {
      return { success: false, error: 'データの取得に失敗しました' };
    }

    // ランキングのTop1を初期選択として取得
    const initialNormalizedPath = rankingResult.data[0]?.normalizedPath;

    // タイムシリーズを取得
    const timeseriesResult = await fetchGa4DashboardTimeseries({
      start,
      end,
      normalizedPath: initialNormalizedPath,
    });

    if (!timeseriesResult.success) {
      return {
        success: false,
        error: timeseriesResult.error ?? 'タイムシリーズの取得に失敗しました',
      };
    }
    if (!timeseriesResult.data) {
      return { success: false, error: 'タイムシリーズの取得に失敗しました' };
    }

    return {
      success: true,
      data: {
        summary: summaryResult.data,
        ranking: rankingResult.data,
        timeseries: timeseriesResult.data,
        ...(initialNormalizedPath !== undefined ? { initialNormalizedPath } : {}),
      },
    };
  } catch (error) {
    console.error('[GA4 Dashboard] Data fetch error:', error);
    return { success: false, error: 'データの取得に失敗しました' };
  }
}
