import AnalyticsClient from './AnalyticsClient';
import { analyticsContentService } from '@/server/services/analyticsContentService';
import { getAnnotationIdsWithUnreadSuggestions } from '@/server/actions/gscNotification.actions';
import { addDaysISO } from '@/lib/date-utils';
import { formatJstDateISO } from '@/lib/ga4-utils';

export const dynamic = 'force-dynamic';

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
  const hasUrlFilterParams = params?.category !== undefined || params?.uncategorized !== undefined;
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

  // 並列でデータ取得（一覧・未読・カテゴリ一覧）
  const [analyticsPage, unreadResult, allCategoryNames] = await Promise.all([
    analyticsContentService.getPage({
      page,
      perPage,
      startDate,
      endDate,
      selectedCategoryNames,
      includeUncategorized,
    }),
    getAnnotationIdsWithUnreadSuggestions(),
    analyticsContentService.getAvailableCategoryNames(),
  ]);
  const { items, total, totalPages, page: resolvedPage, perPage: resolvedPerPage, error, ga4Error } = analyticsPage;
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
      hasUrlFilterParams={hasUrlFilterParams}
    />
  );
}
