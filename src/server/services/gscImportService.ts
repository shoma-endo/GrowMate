import { GscService } from './gscService';
import { SupabaseService } from './supabaseService';
import { getGscQueryMaxPages, getGscQueryRowLimit } from '../lib/gsc-config';
import { normalizeQuery } from '../../lib/normalize-query';
import { normalizeUrl } from '../../lib/normalize-url';
import { aggregateImportResults, splitRangeByDays } from '@/server/lib/gsc-import-utils';
import type {
  GscPageMetric,
  GscPropertyType,
  GscQueryMetricInsert,
  GscSearchAnalyticsRow,
  GscSearchType,
  GscImportOptions,
  GscImportResult,
} from '@/types/gsc';

export class GscImportService {
  private readonly gscService = new GscService();
  private readonly supabaseService = new SupabaseService();
  private readonly queryRowLimit = getGscQueryRowLimit();
  private readonly queryMaxPages = getGscQueryMaxPages();

  private async getAccessContext(userId: string): Promise<{
    accessToken: string;
    propertyUri: string;
    propertyType: GscPropertyType;
  }> {
    const credentials = await this.supabaseService.getGscCredentialByUserId(userId);
    if (!credentials) {
      throw new Error('GSC資格情報が見つかりません');
    }

    const refreshed = await this.gscService.refreshAccessToken(credentials.refreshToken);
    const accessToken = refreshed.accessToken;
    const propertyUri = credentials.propertyUri;
    if (!propertyUri) {
      throw new Error('GSCプロパティが設定されていません');
    }

    const propertyType = this.getPropertyType(propertyUri, credentials.propertyType ?? null);

    return { accessToken, propertyUri, propertyType };
  }

  async importMetrics(userId: string, options: GscImportOptions): Promise<GscImportResult> {
    const startDate = options.startDate;
    const endDate = options.endDate;
    const searchType = options.searchType ?? 'web';
    const maxRows = options.maxRows ?? 1000;

    const { accessToken, propertyUri, propertyType } = await this.getAccessContext(userId);

    const rows = await this.fetchSearchAnalytics({
      accessToken,
      propertyUri,
      startDate,
      endDate,
      searchType,
      rowLimit: maxRows,
      dimensions: ['date', 'page'],
    });

    const metrics = this.mapSearchRowsToPageMetrics(userId, propertyUri, searchType, rows);
    const matchMap = await this.loadAnnotationUrlMap(userId);
    const { upserted, skipped, unmatched } = await this.upsertPageMetrics({
      userId,
      metrics,
      resolveAnnotationId: normalized => (normalized ? (matchMap.get(normalized) ?? null) : null),
      countUnmatched: true,
    });

    const querySummary = await this.importQueryMetrics({
      userId,
      propertyUri,
      propertyType,
      searchType,
      accessToken,
      startDate,
      endDate,
      matchMap,
    });

    return {
      totalFetched: metrics.length,
      upserted,
      skipped,
      unmatched,
      evaluated: 0,
      pageMetricsHitLimit: rows.length >= maxRows,
      querySummary,
    };
  }

  async importPageMetricsForUrl(
    userId: string,
    options: {
      startDate: string;
      endDate: string;
      searchType?: GscSearchType;
      pageUrl: string;
      contentAnnotationId: string;
    }
  ): Promise<{ totalFetched: number; upserted: number; skipped: number }> {
    const { startDate, endDate, searchType = 'web', pageUrl, contentAnnotationId } = options;

    const { accessToken, propertyUri } = await this.getAccessContext(userId);

    const rows = await this.fetchSearchAnalytics({
      accessToken,
      propertyUri,
      startDate,
      endDate,
      searchType,
      rowLimit: this.queryRowLimit,
      // dimensions 順に合わせて keys を受け取る
      dimensions: ['date', 'page'],
      dimensionFilterGroups: [
        {
          filters: [
            {
              dimension: 'page',
              operator: 'equals',
              expression: pageUrl,
            },
          ],
        },
      ],
    });

    const metrics = this.mapSearchRowsToPageMetrics(userId, propertyUri, searchType, rows);
    const { upserted, skipped } = await this.upsertPageMetrics({
      userId,
      metrics,
      resolveAnnotationId: () => contentAnnotationId,
      countUnmatched: false,
    });

    return { totalFetched: metrics.length, upserted, skipped };
  }

  private mapSearchRowsToPageMetrics(
    userId: string,
    propertyUri: string,
    searchType: GscSearchType,
    rows: GscSearchAnalyticsRow[]
  ): GscPageMetric[] {
    return rows
      .map(row => this.toMetric(userId, propertyUri, searchType, row))
      .filter((m): m is GscPageMetric => m !== null);
  }

  private async upsertPageMetrics({
    userId,
    metrics,
    resolveAnnotationId,
    countUnmatched,
  }: {
    userId: string;
    metrics: GscPageMetric[];
    resolveAnnotationId: (normalizedUrl: string | null) => string | null;
    countUnmatched: boolean;
  }): Promise<{ upserted: number; skipped: number; unmatched: number }> {
    let upserted = 0;
    let skipped = 0;
    let unmatched = 0;

    const importedAt = new Date().toISOString();
    // Map のキーを競合キー (property_uri|date|normalizedUrl|search_type) にすることで
    // バッチ内の重複行を事前に排除する（normalized_url は DB 生成列のため同一バッチに
    // 重複があると PostgreSQL がエラーを返す）
    const payloadMap = new Map<
      string,
      {
        user_id: string;
        content_annotation_id: string;
        property_uri: string;
        search_type: string;
        date: string;
        url: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
        imported_at: string;
      }
    >();

    for (const metric of metrics) {
      const annotationId = resolveAnnotationId(metric.normalizedUrl ?? null);
      if (!annotationId) {
        skipped += 1;
        if (countUnmatched) {
          unmatched += 1;
        }
        continue;
      }
      const conflictKey = `${metric.propertyUri}|${metric.date}|${metric.normalizedUrl ?? ''}|${metric.searchType}`;
      payloadMap.set(conflictKey, {
        user_id: userId,
        content_annotation_id: annotationId,
        property_uri: metric.propertyUri,
        search_type: metric.searchType,
        date: metric.date,
        url: metric.url,
        clicks: metric.clicks,
        impressions: metric.impressions,
        ctr: metric.ctr,
        position: metric.position,
        imported_at: importedAt,
      });
    }

    const validPayloads = Array.from(payloadMap.values());

    // 500件単位でバルクアップサート（逐次1件ずつではなく一括処理）
    const BATCH_SIZE = 500;
    for (let i = 0; i < validPayloads.length; i += BATCH_SIZE) {
      const batch = validPayloads.slice(i, i + BATCH_SIZE);
      const { error } = await this.supabaseService
        .getClient()
        .from('gsc_page_metrics')
        .upsert(batch, {
          onConflict: 'user_id,property_uri,date,normalized_url,search_type',
        });

      if (error) {
        console.error(
          `[gscImportService] Batch upsert failed for ${batch.length} rows:`,
          error
        );
        skipped += batch.length;
        continue;
      }

      upserted += batch.length;
    }

    return { upserted, skipped, unmatched };
  }

  async importQueryMetricsForUrl(
    userId: string,
    options: {
      startDate: string;
      endDate: string;
      searchType?: GscSearchType;
      pageUrl: string;
    }
  ): Promise<{
    fetchedRows: number;
    keptRows: number;
    dedupedRows: number;
    fetchErrorPages: number;
    skipped: {
      missingKeys: number;
      invalidUrl: number;
      emptyQuery: number;
      zeroMetrics: number;
    };
    hitLimit: boolean;
  }> {
    const { startDate, endDate, searchType = 'web', pageUrl } = options;

    const { accessToken, propertyUri, propertyType } = await this.getAccessContext(userId);
    const matchMap = await this.loadAnnotationUrlMap(userId);

    return this.importQueryMetrics({
      userId,
      propertyUri,
      propertyType,
      searchType,
      accessToken,
      startDate,
      endDate,
      matchMap,
      pageUrl,
    });
  }

  async importPageAndQueryForUrlWithSplit(
    userId: string,
    options: {
      startDate: string;
      endDate: string;
      pageUrl: string;
      contentAnnotationId: string;
      searchType?: GscSearchType;
      segmentDays?: number;
    }
  ) {
    const {
      startDate,
      endDate,
      pageUrl,
      contentAnnotationId,
      searchType = 'web',
      segmentDays = 30,
    } = options;

    const ranges = splitRangeByDays(startDate, endDate, segmentDays);
    const results: Array<{
      totalFetched: number;
      upserted: number;
      skipped: number;
      unmatched: number;
      querySummary: {
        fetchedRows: number;
        keptRows: number;
        dedupedRows: number;
        fetchErrorPages: number;
        skipped: {
          missingKeys: number;
          invalidUrl: number;
          emptyQuery: number;
          zeroMetrics: number;
        };
        hitLimit: boolean;
      };
    }> = [];

    for (const range of ranges) {
      const pageResult = await this.importPageMetricsForUrl(userId, {
        startDate: range.start,
        endDate: range.end,
        pageUrl,
        contentAnnotationId,
        searchType,
      });

      const summary = await this.importQueryMetricsForUrl(userId, {
        startDate: range.start,
        endDate: range.end,
        pageUrl,
        searchType,
      });

      results.push({
        totalFetched: pageResult.totalFetched,
        upserted: pageResult.upserted,
        skipped: pageResult.skipped,
        unmatched: 0,
        querySummary: summary,
      });
    }

    return aggregateImportResults(results, ranges.length);
  }

  private async fetchSearchAnalytics({
    accessToken,
    propertyUri,
    startDate,
    endDate,
    searchType,
    rowLimit,
    startRow,
    dimensions,
    dimensionFilterGroups,
  }: {
    accessToken: string;
    propertyUri: string;
    startDate: string;
    endDate: string;
    searchType: GscSearchType;
    rowLimit: number;
    startRow?: number;
    dimensions: string[];
    dimensionFilterGroups?: Array<{
      groupType?: 'and';
      filters: Array<{
        dimension: string;
        operator: string;
        expression: string;
      }>;
    }>;
  }): Promise<GscSearchAnalyticsRow[]> {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUri)}/searchAnalytics/query`;
    const body: Record<string, unknown> = {
      startDate,
      endDate,
      dimensions,
      searchType,
      rowLimit,
    };

    if (typeof startRow === 'number' && startRow > 0) {
      body.startRow = startRow;
    }
    if (dimensionFilterGroups && dimensionFilterGroups.length > 0) {
      body.dimensionFilterGroups = dimensionFilterGroups;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GSC Search Analytics API エラー: ${response.status} ${text}`);
    }

    const json = (await response.json()) as { rows?: GscSearchAnalyticsRow[] };
    return Array.isArray(json.rows) ? json.rows : [];
  }

  private toMetric(
    userId: string,
    propertyUri: string,
    searchType: GscSearchType,
    row: GscSearchAnalyticsRow
  ): GscPageMetric | null {
    const dateKey = row.keys?.[0];
    const pageUrl = row.keys?.[1];

    if (!dateKey || !pageUrl) {
      return null;
    }

    const normalized = normalizeUrl(pageUrl);
    return {
      id: crypto.randomUUID(),
      userId,
      propertyUri,
      searchType,
      date: dateKey,
      url: pageUrl,
      normalizedUrl: normalized,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
      importedAt: new Date().toISOString(),
    };
  }

  private async importQueryMetrics({
    userId,
    propertyUri,
    propertyType,
    searchType,
    accessToken,
    startDate,
    endDate,
    matchMap,
    pageUrl,
  }: {
    userId: string;
    propertyUri: string;
    propertyType: GscPropertyType;
    searchType: GscSearchType;
    accessToken: string;
    startDate: string;
    endDate: string;
    matchMap: Map<string, string>;
    pageUrl?: string;
  }): Promise<{
    fetchedRows: number;
    keptRows: number;
    dedupedRows: number;
    fetchErrorPages: number;
    skipped: {
      missingKeys: number;
      invalidUrl: number;
      emptyQuery: number;
      zeroMetrics: number;
    };
    hitLimit: boolean;
  }> {
    const { rows, hitLimit, fetchErrorPages } = await this.fetchQueryAnalyticsRows({
      accessToken,
      propertyUri,
      startDate,
      endDate,
      searchType,
      ...(pageUrl ? { pageUrl } : {}),
    });

    const skipped = {
      missingKeys: 0,
      invalidUrl: 0,
      emptyQuery: 0,
      zeroMetrics: 0,
    };

    if (!rows.length) {
      return {
        fetchedRows: 0,
        keptRows: 0,
        dedupedRows: 0,
        fetchErrorPages,
        skipped,
        hitLimit,
      };
    }

    const metrics: GscQueryMetricInsert[] = [];
    for (const row of rows) {
      const result = this.toQueryMetricWithReason({
        userId,
        propertyUri,
        propertyType,
        searchType,
        row,
        matchMap,
      });
      if (!result.metric) {
        switch (result.reason) {
          case 'missing_keys':
            skipped.missingKeys += 1;
            break;
          case 'invalid_url':
            skipped.invalidUrl += 1;
            break;
          case 'empty_query':
            skipped.emptyQuery += 1;
            break;
          case 'zero_metrics':
            skipped.zeroMetrics += 1;
            break;
          default:
            break;
        }
        continue;
      }
      metrics.push(result.metric);
    }

    if (!metrics.length) {
      return {
        fetchedRows: rows.length,
        keptRows: 0,
        dedupedRows: 0,
        fetchErrorPages,
        skipped,
        hitLimit,
      };
    }

    const deduped = this.aggregateQueryMetrics(metrics);
    await this.supabaseService.upsertGscQueryMetrics(deduped);
    return {
      fetchedRows: rows.length,
      keptRows: metrics.length,
      dedupedRows: deduped.length,
      fetchErrorPages,
      skipped,
      hitLimit,
    };
  }

  /**
   * 同一キー (userId, propertyUri, date, normalizedUrl, queryNormalized, searchType) 内の重複行を集約し、
   * clicks / impressions は合算、ctr は合算値から再計算、position は impressions 加重平均で代表値を決める。
   * contentAnnotationId は非 null を優先採用する。
   */
  private aggregateQueryMetrics(metrics: GscQueryMetricInsert[]): GscQueryMetricInsert[] {
    const map = new Map<string, GscQueryMetricInsert & { weightedPositionSum: number }>();

    for (const metric of metrics) {
      const key = [
        metric.userId,
        metric.propertyUri,
        metric.date,
        metric.normalizedUrl,
        metric.queryNormalized,
        metric.searchType,
      ].join('|');

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          ...metric,
          weightedPositionSum: metric.position * metric.impressions,
        });
        continue;
      }

      const clicks = existing.clicks + metric.clicks;
      const impressions = existing.impressions + metric.impressions;
      const weightedPositionSum =
        existing.weightedPositionSum + metric.position * metric.impressions;

      // contentAnnotationId は非 null を優先
      const contentAnnotationId =
        existing.contentAnnotationId ?? metric.contentAnnotationId ?? null;

      map.set(key, {
        ...existing,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? weightedPositionSum / impressions : 0,
        contentAnnotationId,
        // importedAt / url / query は代表値として既存をそのまま使用
        weightedPositionSum,
      });
    }

    return Array.from(map.values()).map(value => {
      const { weightedPositionSum, ...rest } = value;
      void weightedPositionSum; // eslint整合: 集約用の一時値を破棄
      return rest;
    });
  }

  private async fetchQueryAnalyticsRows({
    accessToken,
    propertyUri,
    startDate,
    endDate,
    searchType,
    pageUrl,
  }: {
    accessToken: string;
    propertyUri: string;
    startDate: string;
    endDate: string;
    searchType: GscSearchType;
    pageUrl?: string;
  }): Promise<{ rows: GscSearchAnalyticsRow[]; hitLimit: boolean; fetchErrorPages: number }> {
    const rows: GscSearchAnalyticsRow[] = [];
    const maxPages = this.queryMaxPages;
    const rowLimit = this.queryRowLimit;
    const concurrency = Math.min(3, maxPages);
    let hitLimit = false;
    let fetchErrorPages = 0;

    for (let pageStart = 0; pageStart < maxPages; pageStart += concurrency) {
      const pageIndexes = Array.from(
        { length: concurrency },
        (_, index) => pageStart + index
      ).filter(pageIndex => pageIndex < maxPages);

      const batchResults = await Promise.all(
        pageIndexes.map(async pageIndex => {
          const startRow = pageIndex * rowLimit;
          try {
            const batch = await this.fetchSearchAnalytics({
              accessToken,
              propertyUri,
              startDate,
              endDate,
              searchType,
              rowLimit,
              startRow,
              // dimensions 順に合わせて keys を受け取る
              dimensions: ['date', 'query', 'page'],
              ...(pageUrl
                ? {
                    dimensionFilterGroups: [
                      {
                        filters: [
                          {
                            dimension: 'page',
                            operator: 'equals',
                            expression: pageUrl,
                          },
                        ],
                      },
                    ],
                  }
                : {}),
            });
            return { pageIndex, batch, error: null };
          } catch (error) {
            console.error(`[gsc-import] query fetch failed: page=${pageIndex}`, error);
            return { pageIndex, batch: [], error };
          }
        })
      );

      batchResults.sort((a, b) => a.pageIndex - b.pageIndex);
      fetchErrorPages += batchResults.filter(result => result.error).length;
      let shouldStop = false;

      for (const result of batchResults) {
        if (!result.batch.length && result.error) {
          continue;
        }
        if (!result.batch.length) {
          shouldStop = true;
          break;
        }

        rows.push(...result.batch);

        if (result.batch.length < rowLimit) {
          shouldStop = true;
          break;
        }
      }

      if (shouldStop) {
        if (pageIndexes.includes(maxPages - 1)) {
          const lastPage = batchResults.find(result => result.pageIndex === maxPages - 1);
          if (lastPage && lastPage.batch.length === rowLimit) {
            hitLimit = true;
          }
        }
        break;
      }
    }

    if (!hitLimit && rows.length >= rowLimit * maxPages) {
      hitLimit = true;
    }

    return { rows, hitLimit, fetchErrorPages };
  }

  private toQueryMetricWithReason({
    userId,
    propertyUri,
    propertyType,
    searchType,
    row,
    matchMap,
  }: {
    userId: string;
    propertyUri: string;
    propertyType: GscPropertyType;
    searchType: GscSearchType;
    row: GscSearchAnalyticsRow;
    matchMap: Map<string, string>;
  }): {
    metric: GscQueryMetricInsert | null;
    reason: 'missing_keys' | 'invalid_url' | 'empty_query' | 'zero_metrics' | null;
  } {
    const [dateKey, queryText, pageUrl] = row.keys ?? [];
    if (!dateKey || !pageUrl || !queryText) {
      return { metric: null, reason: 'missing_keys' };
    }

    const normalizedUrl = normalizeUrl(pageUrl);
    if (!normalizedUrl) {
      return { metric: null, reason: 'invalid_url' };
    }

    const queryNormalized = normalizeQuery(queryText);
    if (!queryNormalized) {
      return { metric: null, reason: 'empty_query' };
    }

    const clicks = row.clicks ?? 0;
    const impressions = row.impressions ?? 0;

    if (clicks === 0 && impressions === 0) {
      return { metric: null, reason: 'zero_metrics' };
    }

    const importedAt = new Date().toISOString();
    return {
      metric: {
        userId,
        propertyUri,
        propertyType,
        searchType,
        date: dateKey,
        url: pageUrl,
        normalizedUrl,
        query: queryText,
        queryNormalized,
        clicks,
        impressions,
        ctr: this.calculateCtr(clicks, impressions, row.ctr),
        position: typeof row.position === 'number' ? row.position : 0,
        contentAnnotationId: matchMap.get(normalizedUrl) ?? null,
        importedAt,
      },
      reason: null,
    };
  }

  private async loadAnnotationUrlMap(userId: string): Promise<Map<string, string>> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('content_annotations')
      .select('id, normalized_url')
      .eq('user_id', userId)
      .not('normalized_url', 'is', null);

    if (error) {
      throw new Error(error.message || 'content_annotations の取得に失敗しました');
    }

    const map = new Map<string, string>();
    (data ?? []).forEach(row => {
      if (row.normalized_url && row.id) {
        map.set(row.normalized_url, row.id);
      }
    });
    return map;
  }

  private getPropertyType(propertyUri: string, fallback?: GscPropertyType | null): GscPropertyType {
    if (fallback === 'sc-domain' || fallback === 'url-prefix') {
      return fallback;
    }
    return propertyUri.startsWith('sc-domain:') ? 'sc-domain' : 'url-prefix';
  }

  private calculateCtr(clicks: number, impressions: number, fallback?: number): number {
    if (typeof fallback === 'number') {
      return fallback;
    }
    if (impressions <= 0) {
      return 0;
    }
    return clicks / impressions;
  }
}

export const gscImportService = new GscImportService();
