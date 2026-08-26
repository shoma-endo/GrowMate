import { SupabaseService } from '@/server/services/supabaseService';

import { normalizeToPath } from '@/lib/ga4-utils';
import {
  aggregateGa4PageMetrics,
  toDisplayedGa4PageMetricSummary,
  type Ga4DailyMetricInput,
} from '@/server/lib/ga4-metrics-aggregation';
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

class AnalyticsContentService {
  async getPage(userId: string, params: AnalyticsContentQuery): Promise<AnalyticsContentPage> {
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
      const client = supabaseService.getClient();

      const fetchAnnotationsPage = async (targetPage: number) => {
        const { data, error } = await client.rpc('get_filtered_content_annotations', {
          p_user_id: userId,
          p_page: targetPage,
          p_per_page: perPage,
          p_selected_category_names: selectedCategoryNames,
          p_include_uncategorized: includeUncategorized,
          p_has_unread_suggestion: params.hasUnreadSuggestion ?? false,
          p_has_unstarted_gsc_evaluation: params.hasUnstartedGscEvaluation ?? false,
          // p_has_unstarted_ga4_evaluation は渡さない。2026-08-26 のサイクル統合で
          // 「コンテンツ評価未開始」フィルタを廃止したため（§10.2）。RPC 側の引数は
          // `default false` で残してあるので、渡さなければ条件が効かない。
          // SQL のシグネチャを変えないのは、本番適用済み関数の再定義を避けるため
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
      let ga4Summaries = new Map<string, Ga4PageMetricSummary>();
      let ga4Truncated = false;
      try {
        const fetched = await this.fetchGa4Summaries(
          [userId],
          annotations,
          startDate,
          endDate
        );
        ga4Summaries = fetched.summaries;
        ga4Truncated = fetched.truncated;
      } catch (ga4Err) {
        console.error('[AnalyticsContentService] GA4 summary fetch failed:', ga4Err);
        ga4Error = 'GA4データの取得に失敗しました。GSCデータのみ表示されます。';
      }

      const items: AnalyticsContentItem[] = annotations.map((annotation, index) => ({
        rowKey: this.buildAnnotationRowKey(annotation, from + index),
        annotation,
        ga4Summary: this.hasValidCanonicalUrl(annotation)
          ? (ga4Summaries.get(normalizeToPath(annotation.canonical_url!)) ?? null)
          : null,
        ga4Evaluation: {
          status: this.readStringField(annotation, 'ga4_evaluation_status'),
          contentScore: this.readNumberField(annotation, 'ga4_content_score'),
          diagnosisCode: this.readStringField(annotation, 'ga4_diagnosis_code'),
          lastEvaluatedAt: this.readStringField(annotation, 'ga4_last_evaluated_at'),
        },
      }));

      return {
        items,
        total,
        totalPages,
        page: resolvedPage,
        perPage,
        ga4Error,
        ga4Truncated,
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
   * 自分のアノテーションから wp_category_names を集約し、
   * 重複を除いてソートしたカテゴリ名の配列を返す。フィルターUIの選択肢に使用する。
   * DB側RPC関数で効率的に集約する（1回のラウンドトリップで完了）。
   */
  async getAvailableCategoryNames(userId: string): Promise<string[]> {
    try {
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
    userIds: string[],
    annotations: AnnotationRecord[],
    startDate: string,
    endDate: string
  ): Promise<{ summaries: Map<string, Ga4PageMetricSummary>; truncated: boolean }> {
    if (!startDate || !endDate || startDate > endDate) {
      return { summaries: new Map(), truncated: false };
    }

    const normalizedPaths = Array.from(
      new Set(
        annotations
          .filter(a => this.hasValidCanonicalUrl(a))
          .map(a => normalizeToPath(a.canonical_url!))
      )
    );

    if (normalizedPaths.length === 0) {
      return { summaries: new Map(), truncated: false };
    }

    const client = supabaseService.getClient();

    const { data: credentials } = await client
      .from('gsc_credentials')
      .select('user_id, ga4_property_id')
      .in('user_id', userIds)
      .not('ga4_property_id', 'is', null);

    const userPropertyPairs = (credentials ?? []).filter(
      (r): r is { user_id: string; ga4_property_id: string } =>
        Boolean(r.user_id && r.ga4_property_id)
    );

    if (userPropertyPairs.length === 0) {
      return { summaries: new Map(), truncated: false };
    }

    const orFilter = userPropertyPairs
      .map(
        p =>
          `and(user_id.eq.${p.user_id},property_id.eq."${String(p.ga4_property_id).replace(/"/g, '""')}")`
      )
      .join(',');

    const { data, error, count } = await client
      .from('ga4_page_metrics_daily')
      .select(
        'normalized_path,sessions,users,engagement_time_sec,bounce_rate,engagement_rate,active_users,cv_event_count,scroll_90_event_count,search_clicks,impressions,ctr,is_sampled,is_partial',
        { count: 'exact' }
      )
      .or(orFilter)
      .in('normalized_path', normalizedPaths)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error('[AnalyticsContentService] GA4 summary fetch failed:', error);
      throw new Error(`GA4データの取得に失敗しました: ${error.message}`);
    }

    const dailyMetrics: Ga4DailyMetricInput[] = [];
    for (const row of data ?? []) {
      if (typeof row.normalized_path !== 'string' || row.normalized_path.length === 0) {
        continue;
      }

      dailyMetrics.push({
        normalizedPath: row.normalized_path,
        sessions: Number(row.sessions ?? 0),
        users: Number(row.users ?? 0),
        engagementTimeSec: Number(row.engagement_time_sec ?? 0),
        bounceRate: Number(row.bounce_rate ?? 0),
        engagementRate: row.engagement_rate === null ? null : Number(row.engagement_rate),
        activeUsers: row.active_users === null ? null : Number(row.active_users),
        cvEventCount: Number(row.cv_event_count ?? 0),
        // null は「対象イベントがプロパティに存在せず未計測」。0（実測0回）と区別する（BR-02）
        scroll90EventCount:
          row.scroll_90_event_count === null ? null : Number(row.scroll_90_event_count),
        searchClicks: Number(row.search_clicks ?? 0),
        impressions: Number(row.impressions ?? 0),
        isSampled: Boolean(row.is_sampled),
        isPartial: Boolean(row.is_partial),
      });
    }

    const aggregatedMetrics = aggregateGa4PageMetrics(dailyMetrics, startDate, endDate);
    return { summaries: new Map(
      Array.from(aggregatedMetrics, ([key, summary]) => [
        key,
        toDisplayedGa4PageMetricSummary(summary),
      ])
    ), truncated: count !== null && count !== undefined && (data?.length ?? 0) < count };
  }

  private hasValidCanonicalUrl(a: AnnotationRecord): boolean {
    return a?.canonical_url != null && String(a.canonical_url).trim() !== '';
  }

  private readStringField(annotation: AnnotationRecord, key: string): string | null {
    const value = (annotation as AnnotationRecord & Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private readNumberField(annotation: AnnotationRecord, key: string): number | null {
    const value = (annotation as AnnotationRecord & Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
