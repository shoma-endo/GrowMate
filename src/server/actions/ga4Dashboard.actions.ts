'use server';

import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { normalizeToPath } from '@/lib/ga4-utils';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';

import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { ServerActionResult } from '@/lib/async-handler';
import type {
  Ga4DashboardSummary,
  Ga4DashboardRankingPage,
  Ga4DashboardTimeseriesPoint,
  Ga4MediaContentScores,
} from '@/types/ga4';
import {
  EMPTY_GA4_DASHBOARD_SUMMARY,
  mapGa4DashboardRankingRows,
  mapGa4DashboardSummaryRow,
  mapGa4DashboardTimeseriesRows,
  type Ga4DashboardRankingRow,
  type Ga4DashboardSummaryRow,
  type Ga4DashboardTimeseriesRow,
} from '@/server/lib/ga4-dashboard-mapping';
import { canAccessGa4 } from '@/server/lib/ga4-permissions';
import { GA4_RANKING_PAGE_SIZE } from '@/lib/constants';
import { calculateMediaScores } from '@/server/lib/ga4-content-score-aggregation';
import { ga4ContentEvaluationService } from '@/server/services/ga4ContentEvaluationService';

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
  offset: z.coerce.number().min(0).default(0),
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
  role: import('@/types/user').UserRole | null;
  error?: string;
  /** メール紐付け競合（クライアントはログイン回復へ誘導） */
  emailLinkConflict?: true;
}

const getAuthUserId = async (): Promise<AuthResult> => {
  const authResult = await authMiddleware();

  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) {
    return {
      userId: null,
      role: null,
      error: linkConflict.error,
      emailLinkConflict: true,
    };
  }

  if (authResult.error || !authResult.userId) {
    return {
      userId: null,
      role: null,
      error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
    };
  }

  return {
    userId: authResult.userId,
    role: authResult.userDetails?.role ?? null,
  };
};

type Ga4AuthFailure = {
  success: false;
  error: string;
  emailLinkConflict?: true;
};

function ga4AuthFailureFrom(authResult: AuthResult): Ga4AuthFailure | null {
  if (authResult.emailLinkConflict) {
    return {
      success: false,
      error: authResult.error ?? ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT,
      emailLinkConflict: true,
    };
  }
  if (authResult.error || !authResult.userId) {
    return {
      success: false,
      error: authResult.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
    };
  }
  return null;
}

function ga4AccessFailureFrom(authResult: AuthResult): Ga4AuthFailure | null {
  const authFailure = ga4AuthFailureFrom(authResult);
  if (authFailure) return authFailure;
  if (!canAccessGa4({ role: authResult.role })) {
    return { success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED };
  }
  return null;
}

/**
 * 連携済みのGA4プロパティIDを引く。
 *
 * `gsc_credentials.user_id` は unique 制約付きなので、1ユーザーにつき最大1件。
 */
async function resolveGa4PropertyId(userId: string): Promise<string | null> {
  const client = supabaseService.getClient();
  const { data } = await client
    .from('gsc_credentials')
    .select('ga4_property_id')
    .eq('user_id', userId)
    .not('ga4_property_id', 'is', null)
    .maybeSingle();
  return data?.ga4_property_id ?? null;
}

/**
 * GA4ダッシュボード: 期間サマリーを取得
 *
 * 集計は `get_ga4_dashboard_summary` が DB 側で行う。日次行をアプリへ持ってくると
 * PostgREST の `db-max-rows = 1000` で黙って打ち切られる（実測で90日=1625行中625行が欠落）。
 */
async function fetchGa4DashboardSummary(input: unknown): Promise<
  ServerActionResult<Ga4DashboardSummary>
> {
  try {
    const authResult = await getAuthUserId();
    const authFail = ga4AccessFailureFrom(authResult);
    if (authFail) return authFail;

    const userId = authResult.userId;
    if (!userId) {
      return { success: false, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const client = supabaseService.getClient();

    // 日付範囲を解析
    const parsed = dateRangeSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'パラメータが無効です' };
    }
    const defaultDateRange = getDefaultDateRange();
    const start = parsed.data.start ?? defaultDateRange.start;
    const end = parsed.data.end ?? defaultDateRange.end;

    const propertyId = await resolveGa4PropertyId(userId);
    if (!propertyId) {
      return { success: false, error: ERROR_MESSAGES.GA4.NOT_CONNECTED };
    }

    const { data, error: rpcError } = await client.rpc('get_ga4_dashboard_summary', {
      p_user_id: userId,
      p_property_id: propertyId,
      p_start: start,
      p_end: end,
    });

    if (rpcError) {
      logSupabaseError('[GA4 Dashboard] Summary fetch failed', rpcError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    const row = Array.isArray(data) ? (data[0] as Ga4DashboardSummaryRow | undefined) : undefined;
    return { success: true, data: row ? mapGa4DashboardSummaryRow(row) : EMPTY_GA4_DASHBOARD_SUMMARY };
  } catch (error) {
    console.error('[GA4 Dashboard] Summary error:', error);
    return { success: false, error: 'サマリーの取得に失敗しました' };
  }
}

/**
 * GA4ダッシュボード: 記事別ランキングを取得
 */
export async function fetchGa4DashboardRanking(input: unknown): Promise<
  ServerActionResult<Ga4DashboardRankingPage>
> {
  try {
    const authResult = await getAuthUserId();
    const authFail = ga4AccessFailureFrom(authResult);
    if (authFail) return authFail;

    const userId = authResult.userId;
    if (!userId) {
      return { success: false, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const client = supabaseService.getClient();

    // パラメータを解析
    const parsed = rankingParamsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: 'パラメータが無効です' };
    }

    const { limit, offset, sort } = parsed.data;
    const defaultDateRange = getDefaultDateRange();
    const dateRange = {
      start: parsed.data.start ?? defaultDateRange.start,
      end: parsed.data.end ?? defaultDateRange.end,
    };

    const propertyId = await resolveGa4PropertyId(userId);
    if (!propertyId) {
      return { success: true, data: { items: [], totalCount: 0, limit, offset } };
    }

    // 集計・ソート・ページングと content_annotations の突合まで DB 側で完結させる。
    // 日次行と記事全件をアプリへ持ってくると、いずれも db-max-rows = 1000 に当たる
    const { data, error: rpcError } = await client.rpc('get_ga4_dashboard_ranking', {
      p_user_id: userId,
      p_property_id: propertyId,
      p_start: dateRange.start,
      p_end: dateRange.end,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    });

    if (rpcError) {
      logSupabaseError('[GA4 Dashboard] Ranking fetch failed', rpcError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    const rows = Array.isArray(data) ? (data as Ga4DashboardRankingRow[]) : [];
    const { items, totalCount } = mapGa4DashboardRankingRows(rows);
    return { success: true, data: { items, totalCount, limit, offset } };
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
    const authFail = ga4AccessFailureFrom(authResult);
    if (authFail) return authFail;

    const userId = authResult.userId;
    if (!userId) {
      return { success: false, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    }
    const client = supabaseService.getClient();

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

    const propertyId = await resolveGa4PropertyId(userId);
    if (!propertyId) {
      return { success: true, data: [] };
    }

    // 未指定なら期間合算の訪問数トップを対象にする。
    // ランキングRPCを limit 1 で呼べば、日次行を持ってこずに1件だけ引ける
    let targetNormalizedPath = normalizedPath;
    if (!targetNormalizedPath) {
      const { data: topRows, error: topError } = await client.rpc('get_ga4_dashboard_ranking', {
        p_user_id: userId,
        p_property_id: propertyId,
        p_start: dateRange.start,
        p_end: dateRange.end,
        p_sort: 'sessions',
        p_limit: 1,
        p_offset: 0,
      });
      if (topError) {
        logSupabaseError('[GA4 Dashboard] Timeseries top path fetch failed', topError);
        return { success: false, error: 'データの取得に失敗しました' };
      }
      const rows = Array.isArray(topRows) ? (topRows as Ga4DashboardRankingRow[]) : [];
      targetNormalizedPath = mapGa4DashboardRankingRows(rows).items[0]?.normalizedPath;
      if (!targetNormalizedPath) {
        return { success: true, data: [] };
      }
    }

    const { data, error: rpcError } = await client.rpc('get_ga4_dashboard_timeseries', {
      p_user_id: userId,
      p_property_id: propertyId,
      p_start: dateRange.start,
      p_end: dateRange.end,
      p_normalized_path: targetNormalizedPath,
    });

    if (rpcError) {
      logSupabaseError('[GA4 Dashboard] Timeseries fetch failed', rpcError);
      return { success: false, error: 'データの取得に失敗しました' };
    }

    const rows = Array.isArray(data) ? (data as Ga4DashboardTimeseriesRow[]) : [];
    return { success: true, data: mapGa4DashboardTimeseriesRows(rows) };
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
    ranking: Ga4DashboardRankingPage;
    timeseries: Ga4DashboardTimeseriesPoint[];
    initialNormalizedPath?: string;
  }>
> {
  try {
    const authResult = await getAuthUserId();
    const authFail = ga4AccessFailureFrom(authResult);
    if (authFail) return authFail;

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
      fetchGa4DashboardRanking({ start, end, limit: GA4_RANKING_PAGE_SIZE, offset: 0, sort: 'sessions' }),
    ]);

    if (!summaryResult.success) {
      return {
        success: false,
        error: summaryResult.error ?? 'サマリーの取得に失敗しました',
        ...(summaryResult.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }

    if (!rankingResult.success) {
      return {
        success: false,
        error: rankingResult.error ?? 'ランキングの取得に失敗しました',
        ...(rankingResult.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
      };
    }
    if (!summaryResult.data || !rankingResult.data) {
      return { success: false, error: 'データの取得に失敗しました' };
    }

    // ランキングのTop1を初期選択として取得
    const initialNormalizedPath = rankingResult.data.items[0]?.normalizedPath;

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
        ...(timeseriesResult.emailLinkConflict ? { emailLinkConflict: true as const } : {}),
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

export async function fetchGa4MediaContentScores(): Promise<ServerActionResult<Ga4MediaContentScores>> {
  try {
    const authResult = await getAuthUserId();
    const authFail = ga4AccessFailureFrom(authResult);
    if (authFail) return authFail;
    if (!authResult.userId) return { success: false, error: ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
    const client = supabaseService.getClient();
    const [latestItems, { count: totalCount, error: totalCountError }] = await Promise.all([
      ga4ContentEvaluationService.fetchLatestSuccessfulContentScores(authResult.userId),
      client.from('content_annotations').select('id', { count: 'exact', head: true }).eq('user_id', authResult.userId),
    ]);
    if (totalCountError) throw totalCountError;
    const points = latestItems;
    const media = calculateMediaScores(points, totalCount ?? 0);
    return { success: true, data: { ...media, points } };
  } catch (error) {
    logSupabaseError('[GA4 Dashboard] Media content scores error', error);
    return { success: false, error: ERROR_MESSAGES.GA4.MEDIA_SCORE_FETCH_FAILED };
  }
}
