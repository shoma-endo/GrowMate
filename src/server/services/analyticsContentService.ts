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
import type { Json } from '@/types/database.types';

const MAX_PER_PAGE = 100;

const supabaseService = new SupabaseService();

// GA4集計用の一時的な型定義
interface Ga4MetricAggregate {
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

export class AnalyticsContentService {
  async getPage(params: AnalyticsContentQuery): Promise<AnalyticsContentPage> {
    const page = Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page)) : 1;
    const perPageRaw = Number.isFinite(params.perPage) ? Math.floor(params.perPage) : MAX_PER_PAGE;
    const perPage = Math.max(1, Math.min(MAX_PER_PAGE, perPageRaw));
    const startDate = params.startDate;
    const endDate = params.endDate;
    const selectedCategoryNames = this.normalizeCategoryNames(params.selectedCategoryNames);
    const includeUncategorized = params.includeUncategorized === true;

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

      const client = supabaseService.getClient();

      const fetchAnnotationsPage = async (targetPage: number) => {
        const { data, error } = await client.rpc('get_filtered_content_annotations', {
          p_user_id: userId,
          p_page: targetPage,
          p_per_page: perPage,
          p_selected_category_names: selectedCategoryNames,
          p_include_uncategorized: includeUncategorized,
        });

        const row = data?.[0] as
          | {
              items: Json;
              total_count: number | string | null;
            }
          | undefined;

        if (!row && !error) {
          console.warn('[AnalyticsContentService] RPC returned empty rows', {
            targetPage,
            perPage,
            selectedCategoryCount: selectedCategoryNames.length,
            includeUncategorized,
          });
        }

        const rawItems = row?.items;
        if (rawItems !== undefined && !Array.isArray(rawItems)) {
          console.warn('[AnalyticsContentService] Unexpected items format from RPC', {
            type: typeof rawItems,
          });
        }

        const hasInvalidItem =
          Array.isArray(rawItems) && rawItems.some(item => !this.isAnnotationRecord(item));
        if (hasInvalidItem) {
          console.warn('[AnalyticsContentService] RPC items contain invalid annotation shape');
        }

        const parsedItems =
          Array.isArray(rawItems) && rawItems.every(item => this.isAnnotationRecord(item))
            ? (rawItems as AnnotationRecord[])
            : [];
        const totalCount = row?.total_count;
        const total =
          typeof totalCount === 'number'
            ? totalCount
            : typeof totalCount === 'string'
              ? Number.parseInt(totalCount, 10) || 0
              : 0;

        return { data: parsedItems, error, total };
      };

      const firstResult = await fetchAnnotationsPage(page);
      let { data, error, total } = firstResult;

      if (error) {
        throw new Error(error.message || 'コンテンツ注釈の取得に失敗しました');
      }

      total = Math.max(0, total);
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const resolvedPage = Math.min(page, totalPages);

      if (resolvedPage !== page) {
        // 意図した仕様として、2回目フェッチ時も total/totalPages は初回フェッチの値を保持する
        // （フェッチ間でデータ変動が起きた場合、件数と取得データに一時的な不整合が生じる可能性はある）
        const resolvedResult = await fetchAnnotationsPage(resolvedPage);
        data = resolvedResult.data;
        error = resolvedResult.error;

        if (error) {
          throw new Error(error.message || 'コンテンツ注釈の取得に失敗しました');
        }
      }

      const annotations = data;
      const from = (resolvedPage - 1) * perPage;

      let ga4Error: string | undefined;
      let ga4Summaries: Map<string, Ga4PageMetricSummary>;
      try {
        ga4Summaries = await this.fetchGa4Summaries(
          [userId],
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
        page: resolvedPage,
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

  private normalizeCategoryNames(input?: string[]): string[] {
    if (!Array.isArray(input)) {
      return [];
    }

    return Array.from(
      new Set(
        input
          .map(name => (typeof name === 'string' ? name.trim() : ''))
          .filter(name => name.length > 0)
      )
    );
  }

  private isAnnotationRecord(value: unknown): value is AnnotationRecord {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.id === 'string' && record.id.length > 0;
  }

  /**
   * アクセス可能な全アノテーションから wp_category_names を集約し、
   * 重複を除いてソートしたカテゴリ名の配列を返す。フィルターUIの選択肢に使用する。
   * DB側RPC関数で効率的に集約する（1回のラウンドトリップで完了）。
   */
  async getAvailableCategoryNames(): Promise<string[]> {
    try {
      const { userId } = await this.resolveUser();
      const client = supabaseService.getClient();

      // RPC関数でDB側で集約（1回のクエリで完了）
      const { data: rows, error } = await client.rpc('get_available_category_names', {
        p_user_id: userId,
      });

      if (error) {
        console.error('[AnalyticsContentService] getAvailableCategoryNames failed:', error.message);
        return [];
      }

      if (!Array.isArray(rows)) {
        return [];
      }

      // RPC関数は既にtrim済み・重複除去済み・ソート済みだが、防御的にSetで再重複除去
      const names = new Set<string>();
      for (const row of rows) {
        const name = row?.name;
        if (typeof name === 'string') {
          const trimmed = name.trim();
          if (trimmed.length > 0) {
            names.add(trimmed);
          }
        }
      }
      return Array.from(names).sort((a, b) => a.localeCompare(b, 'ja'));
    } catch (err) {
      console.error('[AnalyticsContentService] getAvailableCategoryNames error:', err);
      return [];
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
        'normalized_path,sessions,users,engagement_time_sec,bounce_rate,cv_event_count,scroll_90_event_count,search_clicks,impressions,ctr,is_sampled,is_partial'
      )
      .or(orFilter)
      .in('normalized_path', normalizedPaths)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error('[AnalyticsContentService] GA4 summary fetch failed:', error);
      throw new Error(`GA4データの取得に失敗しました: ${error.message}`);
    }

    const summaryMap = new Map<string, Ga4MetricAggregate>();

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
      current.isSampled ||= Boolean(row.is_sampled);
      current.isPartial ||= Boolean(row.is_partial);

      summaryMap.set(key, current);
    }

    const results = new Map<string, Ga4PageMetricSummary>();
    for (const [key, agg] of summaryMap.entries()) {
      const bounceRate =
        agg.bounceRateSessions > 0 ? agg.bounceRateWeighted / agg.bounceRateSessions : 0;
      const ctr = agg.impressions > 0 ? agg.searchClicks / agg.impressions : null;
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
        searchClicks: agg.searchClicks,
        impressions: agg.impressions,
        ctr,
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
