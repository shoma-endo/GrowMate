import { fetchGa4DashboardData } from '@/server/actions/ga4Dashboard.actions';
import Ga4DashboardClient from './Ga4DashboardClient';

type SearchParams = {
  start?: string;
  end?: string;
  annotationId?: string | string[];
  path?: string | string[];
};

export const dynamic = 'force-dynamic';

function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export default async function Ga4DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};

  const startParam = Array.isArray(resolvedSearchParams.start)
    ? resolvedSearchParams.start[0]
    : resolvedSearchParams.start;
  const endParam = Array.isArray(resolvedSearchParams.end)
    ? resolvedSearchParams.end[0]
    : resolvedSearchParams.end;

  const start = typeof startParam === 'string' && isValidDate(startParam) ? startParam : undefined;
  const end = typeof endParam === 'string' && isValidDate(endParam) ? endParam : undefined;
  const initialDateRange = {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };

  // Server Actionで初期データを取得
  const initialResult = await fetchGa4DashboardData({
    start,
    end,
  });

  if (!initialResult.success || !initialResult.data) {
    // エラーの場合はクライアントサイドでハンドリング
    return (
      <Ga4DashboardClient
        initialError={initialResult.error ?? 'データの取得に失敗しました'}
        initialDateRange={initialDateRange}
      />
    );
  }

  return (
    <Ga4DashboardClient
      initialData={initialResult.data}
      initialDateRange={initialDateRange}
    />
  );
}
