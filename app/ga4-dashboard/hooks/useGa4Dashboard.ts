'use client';

import { useMemo, useState, useCallback } from 'react';
import { subDays, format } from 'date-fns';
import {
  fetchGa4DashboardData,
  fetchGa4DashboardRanking,
  fetchGa4DashboardTimeseries,
} from '@/server/actions/ga4Dashboard.actions';
import type {
  Ga4DashboardSummary,
  Ga4DashboardRankingItem,
  Ga4DashboardTimeseriesPoint,
  Ga4DashboardSortKey,
} from '@/types/ga4';

interface DateRange {
  start?: string | null;
  end?: string | null;
}

type PeriodValue = '7' | '14' | '30' | '90';

interface UseGa4DashboardParams {
  initialData?: {
    summary: Ga4DashboardSummary;
    ranking: Ga4DashboardRankingItem[];
    timeseries: Ga4DashboardTimeseriesPoint[];
    initialNormalizedPath?: string;
  };
  initialError?: string;
  initialDateRange: DateRange;
}

interface DashboardData {
  summary: Ga4DashboardSummary;
  ranking: Ga4DashboardRankingItem[];
  timeseries: Ga4DashboardTimeseriesPoint[];
}

export function useGa4Dashboard({
  initialData,
  initialError,
  initialDateRange,
}: UseGa4DashboardParams) {
  const [data, setData] = useState<DashboardData | undefined>(initialData);
  const [error, setError] = useState<string | undefined>(initialError);
  const [isLoading, setIsLoading] = useState(false);

  // 期間プリセット
  const [periodPreset, setPeriodPreset] = useState<PeriodValue>('30');

  // 現在の期間
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    if (initialDateRange.start && initialDateRange.end) {
      return {
        start: initialDateRange.start,
        end: initialDateRange.end,
      };
    }
    // デフォルト: 直近30日
    const nowJst = new Date();
    const endDateJst = subDays(nowJst, 1);
    const startDateJst = subDays(endDateJst, 29);

    return {
      start: format(startDateJst, 'yyyy-MM-dd'),
      end: format(endDateJst, 'yyyy-MM-dd'),
    };
  });

  // 選択中のパス
  const [selectedNormalizedPath, setSelectedNormalizedPath] = useState<
    string | undefined
  >(initialData?.initialNormalizedPath);

  // ソートキー
  const [sortKey, setSortKey] = useState<Ga4DashboardSortKey>('sessions');

  // タイムシリーズ表示メトリック
  const [visibleTimeseriesMetrics, setVisibleTimeseriesMetrics] = useState({
    readRate: true,
    bounceRate: true,
    cvr: true,
  });

  // GA4未接続判定
  const isNotConnected = useMemo(() => {
    if (error && error.includes('GA4が連携されていません')) {
      return true;
    }
    if (error && error.includes('GA4連携を行ってください')) {
      return true;
    }
    return false;
  }, [error]);

  // 期間変更
  const changePeriod = useCallback(async (days: PeriodValue) => {
    setIsLoading(true);
    setError(undefined);

    try {
      const nowJst = new Date();
      const endDateJst = subDays(nowJst, 1);
      const startDateJst = subDays(endDateJst, Number(days) - 1);

      const newStart = format(startDateJst, 'yyyy-MM-dd');
      const newEnd = format(endDateJst, 'yyyy-MM-dd');

      const result = await fetchGa4DashboardData({
        start: newStart,
        end: newEnd,
      });

      if (!result.success || !result.data) {
        setError(result.error ?? 'データの取得に失敗しました');
        setData(undefined);
      } else {
        setData(result.data);
        setDateRange({ start: newStart, end: newEnd });
        setSelectedNormalizedPath(result.data.initialNormalizedPath);
        setPeriodPreset(days);
      }
    } catch (err) {
      console.error('[useGa4Dashboard] Period change failed:', err);
      setError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ソート変更
  const changeSort = useCallback(
    async (key: Ga4DashboardSortKey) => {
      setSortKey(key);
      setIsLoading(true);
      setError(undefined);

      try {
        const result = await fetchGa4DashboardRanking({
          start: dateRange.start,
          end: dateRange.end,
          limit: 100,
          sort: key,
        });

        if (!result.success || !result.data) {
          setError(result.error ?? 'データの取得に失敗しました');
        } else {
          setData((prev) =>
            prev ? { ...prev, ranking: result.data! } : undefined
          );
        }
      } catch (err) {
        console.error('[useGa4Dashboard] Sort change failed:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange.start, dateRange.end]
  );

  // パージ選択（ランキング行クリック）
  const selectPage = useCallback(
    async (item: Ga4DashboardRankingItem) => {
      setSelectedNormalizedPath(item.normalizedPath);
      setIsLoading(true);
      setError(undefined);

      try {
        const result = await fetchGa4DashboardTimeseries({
          start: dateRange.start,
          end: dateRange.end,
          normalizedPath: item.normalizedPath,
        });

        if (!result.success || !result.data) {
          setError(result.error ?? 'データの取得に失敗しました');
        } else {
          setData((prev) =>
            prev ? { ...prev, timeseries: result.data! } : undefined
          );
        }
      } catch (err) {
        console.error('[useGa4Dashboard] Page select failed:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange.start, dateRange.end]
  );

  // タイムシリーズメトリック切替
  const toggleTimeseriesMetric = useCallback(
    (metric: 'readRate' | 'bounceRate' | 'cvr') => {
      setVisibleTimeseriesMetrics((prev) => ({
        ...prev,
        [metric]: !prev[metric],
      }));
    },
    []
  );

  return {
    data,
    error,
    isLoading,
    isNotConnected,
    periodPreset,
    dateRange,
    selectedNormalizedPath,
    sortKey,
    visibleTimeseriesMetrics,
    changePeriod,
    changeSort,
    selectPage,
    toggleTimeseriesMetric,
  };
}
