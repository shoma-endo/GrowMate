import { redirect } from 'next/navigation';

import AnalyticsClient from './AnalyticsClient';
import { analyticsContentService } from '@/server/services/analyticsContentService';
import { gscNotificationService } from '@/server/services/gscNotificationService';
import { instagramMediaService } from '@/server/services/instagramMediaService';
import { getInstagramConnectionStatus } from '@/server/actions/instagramSetup.actions';
import { isInstagramSyncEnabled } from '@/server/lib/instagram-sync-config';
import { SupabaseService } from '@/server/services/supabaseService';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { redirectIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { addDaysISO } from '@/lib/date-utils';
import { formatJstDateISO } from '@/lib/ga4-utils';
import type { InstagramMediaSortKey, InstagramMediaTypeFilter } from '@/types/instagram';

export const dynamic = 'force-dynamic';
// Instagram 手動同期 Server Action が既定 300s を超えるため Fluid Compute 上限まで引き上げる。
// Next.js の route segment config は静的解析のため import 定数を使えず、ここはリテラル必須。
// 値は src/lib/constants.ts の INSTAGRAM_SYNC_MAX_DURATION_SEC と必ず一致させること。
export const maxDuration = 800;

interface AnalyticsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * 日付文字列が YYYY-MM-DD 形式で有効な日付かチェック
 */
function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const parts = dateStr.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const params = await searchParams;
  const unreadSuggestionParam = Array.isArray(params?.unread_suggestion)
    ? params.unread_suggestion[0]
    : params?.unread_suggestion;
  const hasUnreadSuggestion = unreadSuggestionParam === '1';
  // unread_suggestion はカテゴリフィルターと直交するため hasUrlFilterParams に含めない。
  // 含めると ?unread_suggestion=1 のみの URL でも localStorage のカテゴリ復元が
  // スキップされ、保存済みカテゴリフィルターが失われる回帰が発生する。
  const hasUrlFilterParams =
    params?.category !== undefined || params?.uncategorized !== undefined;
  const pageParam = Array.isArray(params?.page) ? params.page[0] : params?.page;
  const pageParsed = Number.parseInt(pageParam ?? '1', 10);
  const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 1;
  const perPage = 10; // 1ページあたり10件で固定表示
  const startParam = Array.isArray(params?.start) ? params.start[0] : params?.start;
  const endParam = Array.isArray(params?.end) ? params.end[0] : params?.end;
  const selectedCategoryNames = Array.isArray(params?.category)
    ? params.category
    : params?.category
      ? [params.category]
      : [];
  const includeUncategorized = params?.uncategorized === '1';

  const todayJst = formatJstDateISO(new Date());
  const defaultEnd = addDaysISO(todayJst, -1);
  const defaultStart = addDaysISO(defaultEnd, -29);

  // 日付バリデーション
  const isStartValid = typeof startParam === 'string' && isValidDate(startParam);
  const isEndValid = typeof endParam === 'string' && isValidDate(endParam);
  let startDate = isStartValid ? startParam : defaultStart;
  let endDate = isEndValid ? endParam : defaultEnd;

  // 開始日 > 終了日 の場合は入れ替え
  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  const authResult = await authMiddleware();
  redirectIfEmailLinkConflict(authResult);
  if (authResult.error || !authResult.userId) {
    redirect('/login');
  }
  const { userId } = authResult;

  const tabParam = Array.isArray(params?.tab) ? params.tab[0] : params?.tab;
  const igPageParam = Array.isArray(params?.ig_page) ? params.ig_page[0] : params?.ig_page;
  const igTypeParam = Array.isArray(params?.ig_type) ? params.ig_type[0] : params?.ig_type;
  const igStartParam = Array.isArray(params?.ig_start) ? params.ig_start[0] : params?.ig_start;
  const igEndParam = Array.isArray(params?.ig_end) ? params.ig_end[0] : params?.ig_end;
  const igSortParam = Array.isArray(params?.ig_sort) ? params.ig_sort[0] : params?.ig_sort;

  const connectionStatusResult = await getInstagramConnectionStatus();
  const instagramConnected =
    connectionStatusResult.success && (connectionStatusResult.data?.connected ?? false);

  let activeTab: 'blog' | 'instagram' = tabParam === 'instagram' ? 'instagram' : 'blog';
  if (!instagramConnected && activeTab === 'instagram') {
    activeTab = 'blog';
  }

  const igPageParsed = Number.parseInt(igPageParam ?? '1', 10);
  const igPage = Number.isFinite(igPageParsed) && igPageParsed > 0 ? igPageParsed : 1;
  const igPerPage = 10;

  const igType: InstagramMediaTypeFilter =
    igTypeParam === 'reels' || igTypeParam === 'feed' ? igTypeParam : 'all';

  const igDefaultEnd = addDaysISO(formatJstDateISO(new Date()), -1);
  const igDefaultStart = addDaysISO(igDefaultEnd, -29);
  const igStartValid = typeof igStartParam === 'string' && isValidDate(igStartParam);
  const igEndValid = typeof igEndParam === 'string' && isValidDate(igEndParam);
  let igStartDate = igStartValid ? igStartParam : igDefaultStart;
  let igEndDate = igEndValid ? igEndParam : igDefaultEnd;
  if (igStartDate > igEndDate) {
    [igStartDate, igEndDate] = [igEndDate, igStartDate];
  }

  const igSort: InstagramMediaSortKey =
    igSortParam === 'reach' || igSortParam === 'views' ? igSortParam : 'posted_at';

  // 並列でデータ取得（一覧・未読・カテゴリ一覧）
  const [analyticsPage, unreadResult, allCategoryNames] = await Promise.all([
    analyticsContentService.getPage(
      userId,
      {
        page,
        perPage,
        startDate,
        endDate,
        selectedCategoryNames,
        includeUncategorized,
        hasUnreadSuggestion,
      }
    ),
    gscNotificationService.getAnnotationIdsWithUnreadSuggestions(userId),
    analyticsContentService.getAvailableCategoryNames(userId),
  ]);
  const { items, total, totalPages, page: resolvedPage, perPage: resolvedPerPage, error, ga4Error } = analyticsPage;

  let instagramMediaPage = {
    items: [] as Awaited<ReturnType<typeof instagramMediaService.getPage>>['items'],
    total: 0,
    totalPages: 1,
    page: igPage,
    perPage: igPerPage,
  };
  let instagramAccountLatestDay = null as Awaited<
    ReturnType<typeof instagramMediaService.getAccountInsightsLatestDay>
  >;
  let instagramLastSyncedAt: string | null = null;
  let instagramBackfillStatus: 'not_started' | 'in_progress' | 'completed' = 'not_started';

  if (instagramConnected && activeTab === 'instagram') {
    const supabaseService = new SupabaseService();
    const [mediaPage, accountDay, credential] = await Promise.all([
      instagramMediaService.getPage(userId, {
        page: igPage,
        perPage: igPerPage,
        type: igType,
        startDate: igStartDate,
        endDate: igEndDate,
        sort: igSort,
      }),
      instagramMediaService.getAccountInsightsLatestDay(userId),
      supabaseService.getInstagramCredential(userId),
    ]);
    instagramMediaPage = mediaPage;
    instagramAccountLatestDay = accountDay;
    instagramLastSyncedAt = credential?.lastSyncedAt ?? null;
    instagramBackfillStatus =
      credential?.backfillCompletedAt != null
        ? 'completed'
        : credential?.backfillCursor != null
          ? 'in_progress'
          : 'not_started';
  }

  const currentPage = resolvedPage ?? page;
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;
  const buildPageHref = (targetPage: number) => {
    const query = new URLSearchParams();
    query.set('page', String(targetPage));
    for (const categoryName of selectedCategoryNames) {
      const trimmed = categoryName.trim();
      if (trimmed.length > 0) {
        query.append('category', trimmed);
      }
    }
    if (includeUncategorized) {
      query.set('uncategorized', '1');
    }
    if (hasUnreadSuggestion) {
      query.set('unread_suggestion', '1');
    }
    if (instagramConnected && activeTab === 'instagram') {
      query.set('tab', 'instagram');
      query.set('ig_page', String(igPage));
      query.set('ig_type', igType);
      query.set('ig_start', igStartDate);
      query.set('ig_end', igEndDate);
      query.set('ig_sort', igSort);
    }
    return `/analytics?${query.toString()}`;
  };

  const prevHref = buildPageHref(Math.max(1, currentPage - 1));
  const nextHref = buildPageHref(Math.min(totalPages, currentPage + 1));

  return (
    <AnalyticsClient
      items={items}
      allCategoryNames={allCategoryNames}
      unreadAnnotationIds={unreadResult.annotationIds}
      error={error ?? null}
      ga4Error={ga4Error ?? null}
      total={total}
      totalPages={totalPages}
      currentPage={currentPage}
      perPage={resolvedPerPage}
      prevHref={prevHref}
      nextHref={nextHref}
      prevDisabled={prevDisabled}
      nextDisabled={nextDisabled}
      startDate={startDate}
      endDate={endDate}
      selectedCategoryNames={selectedCategoryNames}
      includeUncategorized={includeUncategorized}
      hasUnreadSuggestion={hasUnreadSuggestion}
      hasUrlFilterParams={hasUrlFilterParams}
      instagramConnected={instagramConnected}
      activeTab={activeTab}
      instagramItems={instagramMediaPage.items}
      instagramTotal={instagramMediaPage.total}
      instagramTotalPages={instagramMediaPage.totalPages}
      igPage={instagramMediaPage.page}
      igType={igType}
      igStart={igStartDate}
      igEnd={igEndDate}
      igSort={igSort}
      instagramAccountLatestDay={instagramAccountLatestDay}
      instagramLastSyncedAt={instagramLastSyncedAt}
      instagramBackfillStatus={instagramBackfillStatus}
      instagramSyncEnabled={isInstagramSyncEnabled()}
    />
  );
}
