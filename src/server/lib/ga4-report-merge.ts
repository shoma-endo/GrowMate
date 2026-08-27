import { normalizeToPath } from '@/lib/ga4-utils';

/** GA4 レポートを行単位に正規化したもの。base（セッション指標）と event（イベント数）の両方を表す */
export interface Ga4ReportRow {
  date: string;
  pagePath: string;
  eventName?: string;
  sessions?: number;
  users?: number;
  engagementTimeSec?: number;
  bounceRate?: number;
  engagementRate?: number | null;
  activeUsers?: number | null;
  eventCount?: number;
  searchClicks?: number; // organicGoogleSearchClicks（検索クリック数、CTR分子）
  impressions?: number; // organicGoogleSearchImpressions（検索インプレッション数、CTR分母）
}

/**
 * ベース行とイベント行を日付×パスで突き合わせる。
 *
 * `scrollEventName` はプロパティ単位で解決済みの採用イベント名。`null` は
 * 「対象イベントがプロパティに存在せず未計測」を表し、その場合は完読率を
 * 0（実測して0回）ではなく NULL として書く（BR-02）。
 */
export function mergeGa4Reports(
  baseRows: Ga4ReportRow[],
  eventRows: Ga4ReportRow[],
  conversionEvents: string[],
  scrollEventName: string | null
) {
  const conversionSet = new Set(conversionEvents);
  const initialScrollCount = scrollEventName === null ? null : 0;

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
      engagementRate: number | null;
      engagementRateSessions: number;
      activeUsers: number | null;
      cvEventCount: number;
      scroll90EventCount: number | null;
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
    const engagementRate = row.engagementRate ?? null;
    const activeUsers = row.activeUsers ?? null;
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
      existing.activeUsers = existing.activeUsers === null || activeUsers === null
        ? null
        : existing.activeUsers + activeUsers;
      if (existing.engagementRate === null || engagementRate === null) {
        existing.engagementRate = null;
        existing.engagementRateSessions = 0;
      } else if (sessions > 0) {
        const weightedEngagement = (existing.engagementRate ?? 0) * existing.engagementRateSessions + engagementRate * sessions;
        existing.engagementRateSessions += sessions;
        existing.engagementRate = weightedEngagement / existing.engagementRateSessions;
      }
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
        engagementRate,
        engagementRateSessions: engagementRate === null ? 0 : sessions,
        activeUsers,
        cvEventCount: 0,
        scroll90EventCount: initialScrollCount,
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
    if (scrollEventName !== null && row.eventName === scrollEventName) {
      target.scroll90EventCount = (target.scroll90EventCount ?? 0) + count;
    }
    if (conversionSet.has(row.eventName)) {
      target.cvEventCount += count;
    }
  }

  return Array.from(map.values());
}
