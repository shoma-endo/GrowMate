import { GscService } from '@/server/services/gscService';
import { Ga4Service } from '@/server/services/ga4Service';
import { SupabaseService } from '@/server/services/supabaseService';
import { ensureValidAccessToken } from '@/server/services/googleTokenService';
import {
  GA4_EVENT_SCROLL_90,
  ga4DateStringToIso,
  formatJstDateISO,
  getJstDateISOFromTimestamp,
  normalizeToPath,
} from '@/lib/ga4-utils';
import { addDaysISO } from '@/lib/date-utils';
import { GA4_SCOPE } from '@/lib/constants';

interface Ga4ReportRow {
  date: string;
  pagePath: string;
  eventName?: string;
  sessions?: number;
  users?: number;
  engagementTimeSec?: number;
  bounceRate?: number;
  eventCount?: number;
  searchClicks?: number; // organicGoogleSearchClicks（検索クリック数、CTR分子）
  impressions?: number; // organicGoogleSearchImpressions（検索インプレッション数、CTR分母）
}

interface ReportFetchResult {
  rows: Ga4ReportRow[];
  isSampled: boolean;
  isPartial: boolean;
}

export interface Ga4SyncSummary {
  userId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  upserted: number;
  isSampled: boolean;
  isPartial: boolean;
}

export type Ga4SyncResult =
  | { ok: true; data: Ga4SyncSummary }
  | { ok: false; reason: 'not_connected' | 'already_synced' };

export class Ga4ImportService {
  static readonly MAX_USERS_PER_BATCH = 10;
  static readonly MAX_DURATION_MS = 280_000;
  static readonly MAX_ROWS_PER_REQUEST = 10_000;
  static readonly MAX_TOTAL_ROWS = 50_000;
  /** 初回同期時に遡る日数（当日含まず） */
  static readonly INITIAL_SYNC_DAYS = 30;

  private readonly supabaseService = new SupabaseService();
  private readonly gscService = new GscService();
  private readonly ga4Service = new Ga4Service();

  /**
   * JST日付(YYYY-MM-DD)を、getJstDateISOFromTimestamp で同じ日付に復元できるUTCタイムスタンプに変換する。
   * 23:59:59Z だと JST で翌日になるため 0時UTC を使用する。
   */
  private static toUtcMidnightIso(dateIso: string): string {
    return `${dateIso}T00:00:00Z`;
  }

  /**
   * バッチ処理: 複数ユーザーのGA4データを一括同期
   * 
   * **注意**: MVPでは未使用。本番投入後のCron実装時に使用予定。
   * 現時点では手動同期（`syncUser()`）のみ対応。
   */
  async runBatch(): Promise<{
    processed: number;
    attempted: number;
    stoppedReason: 'completed' | 'time_limit' | 'max_users';
  }> {
    const startMs = Date.now();
    const targets = await this.supabaseService.listGa4SyncTargets(
      Ga4ImportService.MAX_USERS_PER_BATCH
    );

    let processed = 0;
    let attempted = 0;
    let stoppedReason: 'completed' | 'time_limit' | 'max_users' = 'completed';

    for (const target of targets) {
      attempted += 1;
      const elapsed = Date.now() - startMs;
      if (elapsed > Ga4ImportService.MAX_DURATION_MS) {
        stoppedReason = 'time_limit';
        break;
      }

      try {
        await this.syncUser(target.userId);
        processed += 1;
      } catch (error) {
        console.error('[ga4ImportService] sync failed for user', target.userId, error);
      }
      if (processed >= Ga4ImportService.MAX_USERS_PER_BATCH) {
        stoppedReason = 'max_users';
        break;
      }
    }

    return { processed, attempted, stoppedReason };
  }

  async syncUser(userId: string): Promise<Ga4SyncResult> {
    const credential = await this.supabaseService.getGscCredentialByUserId(userId);
    if (!credential?.ga4PropertyId) {
      return { ok: false, reason: 'not_connected' };
    }
    const propertyId = credential.ga4PropertyId;
    const scope = credential.scope ?? [];
    if (!scope.includes(GA4_SCOPE)) {
      throw new Error('GA4 scope is missing');
    }

    const accessToken = await this.ensureAccessToken(userId, credential);

    const todayJst = formatJstDateISO(new Date());
    const yesterdayJst = addDaysISO(todayJst, -1);

    const lastSyncedAt = credential.ga4LastSyncedAt;
    const lastSyncedDate = lastSyncedAt ? getJstDateISOFromTimestamp(lastSyncedAt) : null;

    const startDate = lastSyncedDate
      ? addDaysISO(lastSyncedDate, 1)
      : addDaysISO(yesterdayJst, -(Ga4ImportService.INITIAL_SYNC_DAYS - 1));
    const endDate = yesterdayJst;

    if (startDate > endDate) {
      // データ未取得時に同期カーソルを進めると欠損の原因になるため、更新しない
      return { ok: false, reason: 'already_synced' };
    }

    const conversionEvents = Array.isArray(credential.ga4ConversionEvents)
      ? credential.ga4ConversionEvents
      : [];
    const eventNames = Array.from(new Set([GA4_EVENT_SCROLL_90, ...conversionEvents]));

    let baseReport: ReportFetchResult;
    try {
      baseReport = await this.fetchBaseReport(accessToken, propertyId, {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error('[ga4ImportService.syncUser] baseReport fetch failed', {
        userId,
        propertyId,
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    let eventReport: ReportFetchResult;
    try {
      eventReport = await this.fetchEventReport(accessToken, propertyId, {
        startDate,
        endDate,
        eventNames,
      });
    } catch (error) {
      console.error('[ga4ImportService.syncUser] eventReport fetch failed', {
        userId,
        propertyId,
        startDate,
        endDate,
        eventNames,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const merged = this.mergeReports(baseReport.rows, eventReport.rows, conversionEvents);
    const importedAt = new Date().toISOString();

    const rowsToSave = merged.map(row => {
      // CTR計算: impressionsが0の場合はNULL、それ以外はsearchClicks/impressions（0-1の比率）
      const ctr = row.impressions > 0 ? row.searchClicks / row.impressions : null;

      return {
        userId,
        propertyId,
        date: row.date,
        pagePath: row.pagePath,
        normalizedPath: row.normalizedPath,
        sessions: row.sessions,
        users: row.users,
        engagementTimeSec: row.engagementTimeSec,
        bounceRate: row.bounceRate,
        cvEventCount: row.cvEventCount,
        scroll90EventCount: row.scroll90EventCount,
        searchClicks: row.searchClicks,
        impressions: row.impressions,
        ctr,
        isSampled: baseReport.isSampled || eventReport.isSampled,
        isPartial: baseReport.isPartial || eventReport.isPartial,
        importedAt,
      };
    });

    await this.supabaseService.upsertGa4PageMetricsDaily(rowsToSave);
    await this.supabaseService.updateGscCredential(userId, {
      // 次回の startDate を正しく進めるため、同期実行時刻ではなく取り込み済み最終日を保持する
      ga4LastSyncedAt: Ga4ImportService.toUtcMidnightIso(endDate),
    });

    console.log('[ga4ImportService.syncUser] completed', {
      userId,
      propertyId,
      startDate,
      endDate,
      baseRows: baseReport.rows.length,
      eventRows: eventReport.rows.length,
      mergedRows: merged.length,
      upserted: rowsToSave.length,
      isSampled: baseReport.isSampled || eventReport.isSampled,
      isPartial: baseReport.isPartial || eventReport.isPartial,
    });

    return {
      ok: true,
      data: {
        userId,
        propertyId,
        startDate,
        endDate,
        upserted: rowsToSave.length,
        isSampled: baseReport.isSampled || eventReport.isSampled,
        isPartial: baseReport.isPartial || eventReport.isPartial,
      },
    };
  }

  private async ensureAccessToken(
    userId: string,
    credential: {
      refreshToken: string;
      accessToken?: string | null;
      accessTokenExpiresAt?: string | null;
      scope?: string[] | null;
    }
  ): Promise<string> {
    return ensureValidAccessToken(credential, {
      refreshAccessToken: (rt) => this.gscService.refreshAccessToken(rt),
      persistToken: (accessToken, expiresAt, scope) =>
        this.supabaseService.updateGscCredential(userId, {
          accessToken,
          accessTokenExpiresAt: expiresAt,
          scope: scope ?? credential.scope ?? null,
        }),
    });
  }

  private async fetchBaseReport(
    accessToken: string,
    propertyId: string,
    range: { startDate: string; endDate: string }
  ): Promise<ReportFetchResult> {
    return this.fetchReportWithPagination(accessToken, propertyId, 'base', {
      dimensions: [{ name: 'date' }, { name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'userEngagementDuration' },
        { name: 'bounceRate' },
        { name: 'organicGoogleSearchClicks' },    // 検索クリック数（CTR分子）
        { name: 'organicGoogleSearchImpressions' } // 検索インプレッション数（CTR分母）
      ],
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    });
  }

  private async fetchEventReport(
    accessToken: string,
    propertyId: string,
    range: { startDate: string; endDate: string; eventNames: string[] }
  ): Promise<ReportFetchResult> {
    return this.fetchReportWithPagination(accessToken, propertyId, 'event', {
      // ベース指標と結合軸を一致させるため、イベント側も landingPage を使用する
      dimensions: [{ name: 'date' }, { name: 'landingPage' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: range.eventNames },
        },
      },
    });
  }

  private async fetchReportWithPagination(
    accessToken: string,
    propertyId: string,
    mode: 'base' | 'event',
    body: Record<string, unknown>
  ): Promise<ReportFetchResult> {
    const rows: Ga4ReportRow[] = [];
    let offset = 0;
    let isSampled = false;
    let isPartial = false;

    let pageIndex = 0;
    while (rows.length < Ga4ImportService.MAX_TOTAL_ROWS) {
      const remaining = Ga4ImportService.MAX_TOTAL_ROWS - rows.length;
      const limit = Math.min(Ga4ImportService.MAX_ROWS_PER_REQUEST, remaining);

      const response = await this.ga4Service.runReport(accessToken, propertyId, {
        ...body,
        limit,
        offset,
      });

      const responseRows = Array.isArray(response.rows) ? response.rows : [];
      console.log('[ga4ImportService.fetchReportWithPagination]', {
        mode,
        pageIndex,
        offset,
        limit,
        returnedRows: responseRows.length,
        totalRowCount: response.rowCount ?? null,
        accumulatedRows: rows.length,
      });
      const samplingMetadatas = response.metadata?.samplingMetadatas;
      isSampled ||=
        Boolean(response.metadata?.dataLossFromOtherRow) ||
        Boolean(response.metadata?.subjectToThresholding) ||
        (Array.isArray(samplingMetadatas) && samplingMetadatas.length > 0);

      if (response.rowCount && response.rowCount > Ga4ImportService.MAX_TOTAL_ROWS) {
        isPartial = true;
      }

      for (const row of responseRows) {
        const dimensions = row.dimensionValues ?? [];
        const metrics = row.metricValues ?? [];
        const date = ga4DateStringToIso(dimensions[0]?.value ?? '');
        const landingPage = dimensions[1]?.value ?? '';
        if (!date || !landingPage) {
          continue;
        }
        if (mode === 'event') {
          const eventName = dimensions[2]?.value;
          if (!eventName) {
            continue;
          }
          const eventCount = Number(metrics[0]?.value ?? 0);
          rows.push({
            date,
            pagePath: landingPage,
            eventName,
            eventCount,
          });
        } else {
          const sessions = Number(metrics[0]?.value ?? 0);
          const users = Number(metrics[1]?.value ?? 0);
          const engagementTimeSec = Number(metrics[2]?.value ?? 0);
          const bounceRate = Number(metrics[3]?.value ?? 0);
          const searchClicks = Number(metrics[4]?.value ?? 0);
          const impressions = Number(metrics[5]?.value ?? 0);
          rows.push({
            date,
            pagePath: landingPage,
            sessions,
            users,
            engagementTimeSec,
            bounceRate,
            searchClicks,
            impressions,
          });
        }
      }

      if (responseRows.length < limit) {
        break;
      }

      pageIndex += 1;
      offset += limit;
      if (offset >= Ga4ImportService.MAX_TOTAL_ROWS) {
        isPartial = true;
        break;
      }
    }

    if (rows.length >= Ga4ImportService.MAX_TOTAL_ROWS) {
      isPartial = true;
    }

    return { rows, isSampled, isPartial };
  }

  private mergeReports(
    baseRows: Ga4ReportRow[],
    eventRows: Ga4ReportRow[],
    conversionEvents: string[]
  ) {
    const conversionSet = new Set(conversionEvents);
    const map = new Map<
      string,
      {
        date: string;
        pagePath: string;
        normalizedPath: string;
        sessions: number;
        users: number;
        engagementTimeSec: number;
        bounceRate: number;
        cvEventCount: number;
        scroll90EventCount: number;
        searchClicks: number;
        impressions: number;
      }
    >();

    for (const row of baseRows) {
      const normalizedPath = normalizeToPath(row.pagePath);
      const key = `${row.date}::${normalizedPath}`;
      const sessions = row.sessions ?? 0;
      const users = row.users ?? 0;
      const engagementTimeSec = row.engagementTimeSec ?? 0;
      const bounceRate = row.bounceRate ?? 0;
      const searchClicks = row.searchClicks ?? 0;
      const impressions = row.impressions ?? 0;

      const existing = map.get(key);
      if (existing) {
        const totalSessions = existing.sessions + sessions;
        existing.bounceRate =
          totalSessions > 0
            ? (existing.bounceRate * existing.sessions + bounceRate * sessions) / totalSessions
            : 0;
        existing.sessions = totalSessions;
        existing.users += users;
        existing.engagementTimeSec += engagementTimeSec;
        existing.searchClicks += searchClicks;
        existing.impressions += impressions;
      } else {
        map.set(key, {
          date: row.date,
          pagePath: row.pagePath,
          normalizedPath,
          sessions,
          users,
          engagementTimeSec,
          bounceRate,
          cvEventCount: 0,
          scroll90EventCount: 0,
          searchClicks,
          impressions,
        });
      }
    }

    for (const row of eventRows) {
      if (!row.eventName) continue;
      const normalizedPath = normalizeToPath(row.pagePath);
      const key = `${row.date}::${normalizedPath}`;
      const target = map.get(key);
      // ベース行（セッションデータ）が存在しないイベントは集計対象外とする
      // 理由: ページコンテキストなしのイベントは分析上の意味が限定的なため
      if (!target) continue;

      const count = row.eventCount ?? 0;
      if (row.eventName === GA4_EVENT_SCROLL_90) {
        target.scroll90EventCount += count;
      }
      if (conversionSet.has(row.eventName)) {
        target.cvEventCount += count;
      }
    }

    return Array.from(map.values());
  }
}

export const ga4ImportService = new Ga4ImportService();
