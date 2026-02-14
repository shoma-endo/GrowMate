import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';
import { normalizeToPath } from '@/lib/ga4-utils';
import type { AnnotationRecord } from '@/types/annotation';
import type {
  AnalyticsContentItem,
  AnalyticsContentPage,
  AnalyticsContentQuery,
} from '@/types/analytics';
import type { Ga4PageMetricSummary } from '@/types/ga4';

const MAX_PER_PAGE = 100;

const supabaseService = new SupabaseService();

export class AnalyticsContentService {
  async getPage(params: AnalyticsContentQuery): Promise<AnalyticsContentPage> {
    const page = Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page)) : 1;
    const perPageRaw = Number.isFinite(params.perPage) ? Math.floor(params.perPage) : MAX_PER_PAGE;
    const perPage = Math.max(1, Math.min(MAX_PER_PAGE, perPageRaw));
    const startDate = params.startDate;
    const endDate = params.endDate;

    const baseline: AnalyticsContentPage = {
      items: [],
      total: 0,
      totalPages: 1,
      page,
      perPage,
      ga4Error: undefined,
    };

    try {
      const { userId } = await this.resolveUser();
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;

      const client = supabaseService.getClient();

      // アクセス可能なユーザーIDを取得（オーナー/従業員の相互閲覧対応）
      const { data: accessibleIds, error: accessError } = await client.rpc(
        'get_accessible_user_ids',
        { p_user_id: userId }
      );

      if (accessError || !accessibleIds) {
        throw new Error('アクセス権の確認に失敗しました');
      }

      const { data, error, count } = await client
        .from('content_annotations')
        .select('*', { count: 'exact', head: false })
        .in('user_id', accessibleIds)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) {
        throw new Error(error.message || 'コンテンツ注釈の取得に失敗しました');
      }

      const annotations = (data ?? []) as AnnotationRecord[];
      const total = count ?? annotations.length;
      const totalPages = Math.max(1, Math.ceil(total / perPage));

      let ga4Error: string | undefined;
      let ga4Summaries: Map<string, Ga4PageMetricSummary>;
      try {
        ga4Summaries = await this.fetchGa4Summaries(
          accessibleIds as string[],
          annotations,
          startDate,
          endDate
        );
      } catch (ga4Err) {
        console.error('[AnalyticsContentService] GA4 summary fetch failed:', ga4Err);
        ga4Error = 'GA4データの取得に失敗しました。GSCデータのみ表示されます。';
        ga4Summaries = new Map();
      }

      const items: AnalyticsContentItem[] = annotations.map((annotation, index) => ({
        rowKey: this.buildAnnotationRowKey(annotation, from + index),
        annotation,
        ga4Summary: this.hasValidCanonicalUrl(annotation)
          ? (ga4Summaries.get(normalizeToPath(annotation.canonical_url!)) ?? null)
          : null,
      }));

      return {
        items,
        total,
        totalPages,
        page,
        perPage,
        ga4Error,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ページデータの取得に失敗しました';
      return {
        ...baseline,
        error: message,
      };
    }
  }

  private async fetchGa4Summaries(
    accessibleIds: string[],
    annotations: AnnotationRecord[],
    startDate: string,
    endDate: string
  ): Promise<Map<string, Ga4PageMetricSummary>> {
    if (!startDate || !endDate || startDate > endDate) {
      return new Map();
    }

    const normalizedPaths = Array.from(
      new Set(
        annotations
          .filter(a => this.hasValidCanonicalUrl(a))
          .map(a => normalizeToPath(a.canonical_url!))
      )
    );

    if (normalizedPaths.length === 0) {
      return new Map();
    }

    const client = supabaseService.getClient();

    const { data: credentials } = await client
      .from('gsc_credentials')
      .select('user_id, ga4_property_id')
      .in('user_id', accessibleIds)
      .not('ga4_property_id', 'is', null);

    const userPropertyPairs = (credentials ?? []).filter(
      (r): r is { user_id: string; ga4_property_id: string } =>
        Boolean(r.user_id && r.ga4_property_id)
    );

    if (userPropertyPairs.length === 0) {
      return new Map();
    }

    const orFilter = userPropertyPairs
      .map(
        p =>
          `and(user_id.eq.${p.user_id},property_id.eq."${String(p.ga4_property_id).replace(/"/g, '""')}")`
      )
      .join(',');

    const { data, error } = await client
      .from('ga4_page_metrics_daily')
      .select(
        'normalized_path,sessions,users,engagement_time_sec,bounce_rate,cv_event_count,scroll_90_event_count,is_sampled,is_partial'
      )
      .or(orFilter)
      .in('normalized_path', normalizedPaths)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error('[AnalyticsContentService] GA4 summary fetch failed:', error);
      throw new Error(`GA4データの取得に失敗しました: ${error.message}`);
    }

    const summaryMap = new Map<
      string,
      {
        sessions: number;
        users: number;
        engagementTimeSec: number;
        bounceRateWeighted: number;
        bounceRateSessions: number;
        cvEventCount: number;
        scroll90EventCount: number;
        isSampled: boolean;
        isPartial: boolean;
      }
    >();

    for (const row of data ?? []) {
      const key = row.normalized_path as string;
      const current = summaryMap.get(key) ?? {
        sessions: 0,
        users: 0,
        engagementTimeSec: 0,
        bounceRateWeighted: 0,
        bounceRateSessions: 0,
        cvEventCount: 0,
        scroll90EventCount: 0,
        isSampled: false,
        isPartial: false,
      };

      const sessions = Number(row.sessions ?? 0);
      const users = Number(row.users ?? 0);
      const engagementTimeSec = Number(row.engagement_time_sec ?? 0);
      const bounceRate = Number(row.bounce_rate ?? 0);
      const cvEventCount = Number(row.cv_event_count ?? 0);
      const scroll90EventCount = Number(row.scroll_90_event_count ?? 0);

      current.sessions += sessions;
      current.users += users;
      current.engagementTimeSec += engagementTimeSec;
      current.cvEventCount += cvEventCount;
      current.scroll90EventCount += scroll90EventCount;
      current.bounceRateWeighted += bounceRate * sessions;
      current.bounceRateSessions += sessions;
      current.isSampled ||= Boolean(row.is_sampled);
      current.isPartial ||= Boolean(row.is_partial);

      summaryMap.set(key, current);
    }

    const results = new Map<string, Ga4PageMetricSummary>();
    for (const [key, agg] of summaryMap.entries()) {
      const bounceRate =
        agg.bounceRateSessions > 0 ? agg.bounceRateWeighted / agg.bounceRateSessions : 0;
      results.set(key, {
        normalizedPath: key,
        dateFrom: startDate,
        dateTo: endDate,
        sessions: agg.sessions,
        users: agg.users,
        engagementTimeSec: agg.engagementTimeSec,
        bounceRate,
        cvEventCount: agg.cvEventCount,
        scroll90EventCount: agg.scroll90EventCount,
        isSampled: agg.isSampled,
        isPartial: agg.isPartial,
      });
    }

    return results;
  }

  private async resolveUser(): Promise<{ userId: string }> {
    const { accessToken: liffAccessToken, refreshToken } = await getLiffTokensFromCookies();

    const authResult = await authMiddleware(liffAccessToken, refreshToken);

    if (authResult.needsReauth || authResult.error || !authResult.userId) {
      throw new Error(authResult.error || 'ユーザー認証に失敗しました');
    }

    return { userId: authResult.userId };
  }

  private hasValidCanonicalUrl(a: AnnotationRecord): boolean {
    return a?.canonical_url != null && String(a.canonical_url).trim() !== '';
  }

  private buildAnnotationRowKey(annotation: AnnotationRecord, fallbackIndex: number): string {
    if (annotation?.id) {
      return `annotation:${annotation.id}`;
    }
    if (annotation?.session_id) {
      return `annotation-session:${annotation.session_id}`;
    }
    return `annotation-index:${fallbackIndex}`;
  }
}

export const analyticsContentService = new AnalyticsContentService();
