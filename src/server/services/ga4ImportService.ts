import { GscService } from '@/server/services/gscService';
import { Ga4Service } from '@/server/services/ga4Service';
import { SupabaseService } from '@/server/services/supabaseService';
import { ensureValidAccessToken } from '@/server/services/googleTokenService';
import {
  GA4_SCROLL_EVENT_NAMES,
  resolveGa4ScrollEventName,
  ga4DateStringToIso,
  formatJstDateISO,
  getJstDateISOFromTimestamp,
  normalizeToPath,
} from '@/lib/ga4-utils';
import { GA4_SCOPE } from '@/lib/constants';
import { GA4_EVALUATION_DEFAULT_DAYS } from '@/lib/ga4-evaluation-period';
import { addDaysISO } from '@/lib/date-utils';
import { resolveGa4SyncRange, splitGa4SyncRange } from '@/server/lib/ga4-sync-range';
import { mergeGa4Reports, type Ga4ReportRow } from '@/server/lib/ga4-report-merge';

interface ReportFetchResult {
  rows: Ga4ReportRow[];
  isSampled: boolean;
  isPartial: boolean;
}

interface Ga4SyncSummary {
  userId: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  upserted: number;
  isSampled: boolean;
  isPartial: boolean;
}

type Ga4SyncResult =
  | { ok: true; data: Ga4SyncSummary }
  | { ok: false; reason: 'not_connected' | 'already_synced' };

interface Ga4SyncOptions {
  backfillDays?: number | undefined;
}

class Ga4ImportService {
  static readonly MAX_USERS_PER_BATCH = 10;
  static readonly MAX_DURATION_MS = 280_000;
  static readonly MAX_ROWS_PER_REQUEST = 10_000;
  static readonly MAX_TOTAL_ROWS = 50_000;
  /** 初回同期時に遡る日数（当日含まず） */
  static readonly INITIAL_SYNC_DAYS = 30;
  /** 1レポートで取得する最大日数。長期間の再取込を分割して行数打ち切りを避ける */
  static readonly MAX_DAYS_PER_WINDOW = 30;

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

  async syncUser(userId: string, options?: Ga4SyncOptions): Promise<Ga4SyncResult> {
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

    const lastSyncedAt = credential.ga4LastSyncedAt;
    const lastSyncedDate = lastSyncedAt ? getJstDateISOFromTimestamp(lastSyncedAt) : null;
    const syncRange = resolveGa4SyncRange({
      todayJst,
      lastSyncedDate,
      initialSyncDays: Ga4ImportService.INITIAL_SYNC_DAYS,
      backfillDays: options?.backfillDays,
    });

    if (!syncRange.ok) {
      // データ未取得時に同期カーソルを進めると欠損の原因になるため、更新しない
      return { ok: false, reason: 'already_synced' };
    }
    const { startDate, endDate } = syncRange.range;

    const conversionEvents = Array.isArray(credential.ga4ConversionEvents)
      ? credential.ga4ConversionEvents
      : [];

    // スクロールイベント名は「このプロパティに定義があるか」で決まるものなので、
    // 取込ウィンドウ単位ではなく同期実行ごとに1度だけ解決する。
    // ウィンドウ単位で判定すると、増分同期（1日窓）でたまたま誰も90%到達しなかった日に
    // 「未計測」と誤判定し、評価側の全か無か集計で90日分の完読率が丸ごと落ちる。
    const scrollEventName = await this.resolveScrollEventNameForProperty(
      accessToken,
      propertyId,
      endDate
    );
    const eventNames = Array.from(
      new Set([...(scrollEventName === null ? [] : [scrollEventName]), ...conversionEvents])
    );

    // 長期間の再取込でも1レポートの行数を日数で有界化する（打ち切りの静かな欠損を防ぐ）
    const windows = splitGa4SyncRange(syncRange.range, Ga4ImportService.MAX_DAYS_PER_WINDOW);

    let totalUpserted = 0;
    let isSampled = false;
    let isPartial = false;

    for (const window of windows) {
      const result = await this.importWindow({
        userId,
        propertyId,
        accessToken,
        conversionEvents,
        eventNames,
        scrollEventName,
        range: window,
      });
      totalUpserted += result.upserted;
      isSampled = isSampled || result.isSampled;
      isPartial = isPartial || result.isPartial;
    }

    // 0件時はカーソルを進めず、次回同一範囲を再取得して取りこぼしを防ぐ
    if (totalUpserted > 0) {
      await this.supabaseService.updateGscCredential(userId, {
        // 次回の startDate を正しく進めるため、同期実行時刻ではなく取り込み済み最終日を保持する
        ga4LastSyncedAt: Ga4ImportService.toUtcMidnightIso(endDate),
      });
    }

    return {
      ok: true,
      data: {
        userId,
        propertyId,
        startDate,
        endDate,
        upserted: totalUpserted,
        isSampled,
        isPartial,
      },
    };
  }

  /**
   * 1つの日付窓ぶんの GA4 レポートを取得して upsert する。同期カーソルは更新しない。
   */
  private async importWindow(params: {
    userId: string;
    propertyId: string;
    accessToken: string;
    conversionEvents: string[];
    eventNames: string[];
    /** null は「対象イベントがこのプロパティに存在せず未計測」。0（実測して0回）と区別する（BR-02） */
    scrollEventName: string | null;
    range: { startDate: string; endDate: string };
  }): Promise<{ upserted: number; isSampled: boolean; isPartial: boolean }> {
    const { userId, propertyId, accessToken, conversionEvents, eventNames, scrollEventName } =
      params;
    const { startDate, endDate } = params.range;

    let baseReport: ReportFetchResult;
    try {
      baseReport = await this.fetchBaseReport(accessToken, propertyId, {
        startDate,
        endDate,
      });
    } catch (error) {
      console.error('[ga4ImportService.importWindow] baseReport fetch failed', {
        userId,
        propertyId,
        startDate,
        endDate,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // 要求するイベントが1つも無い（スクロール未定義かつCV未設定）ときは空フィルタで
    // レポートを投げず、イベント行なしとして扱う
    let eventReport: ReportFetchResult = { rows: [], isSampled: false, isPartial: false };
    try {
      if (eventNames.length > 0) {
        eventReport = await this.fetchEventReport(accessToken, propertyId, {
          startDate,
          endDate,
          eventNames,
        });
      }
    } catch (error) {
      console.error('[ga4ImportService.importWindow] eventReport fetch failed', {
        userId,
        propertyId,
        startDate,
        endDate,
        eventNames,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const merged = mergeGa4Reports(
      baseReport.rows,
      eventReport.rows,
      conversionEvents,
      scrollEventName
    );
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
        engagementRate: row.engagementRate,
        activeUsers: row.activeUsers,
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

    if (rowsToSave.length > 0) {
      await this.supabaseService.upsertGa4PageMetricsDaily(rowsToSave);
    }

    return {
      upserted: rowsToSave.length,
      isSampled: baseReport.isSampled || eventReport.isSampled,
      isPartial: baseReport.isPartial || eventReport.isPartial,
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
    // landingPage はセッションスコープ、totalUsers はユーザースコープのため互換性なし。
    // organicGoogleSearchClicks/Impressions は Search Console 専用で landingPage と非互換（landingPagePlusQueryString 等のみ対応）。
    // API 制約により landingPage 単位で totalUsers/検索指標を取得できないため、CVR 分母は sessions、検索CTR は 0/NULL。
    return this.fetchReportWithPagination(accessToken, propertyId, 'base', {
      dimensions: [{ name: 'date' }, { name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'userEngagementDuration' },
        { name: 'bounceRate' },
        { name: 'engagementRate' },
        { name: 'activeUsers' },
      ],
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    });
  }

  /**
   * このプロパティに90%スクロールイベントの定義があるかを、同期実行ごとに1度だけ確かめる。
   *
   * 判定窓は評価期間（既定90日）に揃える。取込ウィンドウ（増分同期では1日）で判定すると、
   * 「イベントは設定されているが、その日たまたま誰も90%到達しなかった」だけで未計測と
   * 誤判定してしまうため。返り値が null のときだけ、その同期で書く行の完読率を NULL にする。
   *
   * イベント名のディメンションだけを引くのでレスポンスは数行に収まる。
   */
  private async resolveScrollEventNameForProperty(
    accessToken: string,
    propertyId: string,
    endDate: string
  ): Promise<string | null> {
    const startDate = addDaysISO(endDate, -(GA4_EVALUATION_DEFAULT_DAYS - 1));
    const response = await this.ga4Service.runReport(accessToken, propertyId, {
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dateRanges: [{ startDate, endDate }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: [...GA4_SCROLL_EVENT_NAMES] },
        },
      },
      limit: GA4_SCROLL_EVENT_NAMES.length,
    });
    const rows = Array.isArray(response.rows) ? response.rows : [];
    return resolveGa4ScrollEventName(rows.map(row => row.dimensionValues?.[0]?.value));
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

    while (rows.length < Ga4ImportService.MAX_TOTAL_ROWS) {
      const remaining = Ga4ImportService.MAX_TOTAL_ROWS - rows.length;
      const limit = Math.min(Ga4ImportService.MAX_ROWS_PER_REQUEST, remaining);

      const response = await this.ga4Service.runReport(accessToken, propertyId, {
        ...body,
        limit,
        offset,
      });

      const responseRows = Array.isArray(response.rows) ? response.rows : [];
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
          // totalUsers は landingPage と非互換のため、CVR 分母に sessions を充てる
          const users = sessions;
          const engagementTimeSec = Number(metrics[1]?.value ?? 0);
          const bounceRate = Number(metrics[2]?.value ?? 0);
          const engagementRate = metrics[3]?.value === undefined ? null : Number(metrics[3].value);
          const activeUsers = metrics[4]?.value === undefined ? null : Number(metrics[4].value);
          rows.push({
            date,
            pagePath: landingPage,
            sessions,
            users,
            engagementTimeSec,
            bounceRate,
            engagementRate,
            activeUsers,
            // organicGoogleSearchClicks/Impressions は landingPage と非互換のため取得不可
            searchClicks: 0,
            impressions: 0,
          });
        }
      }

      if (responseRows.length < limit) {
        break;
      }

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

}

export const ga4ImportService = new Ga4ImportService();
