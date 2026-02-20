'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, AlertTriangle, Settings } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { SummaryCards } from './components/SummaryCards';
import { RankingTab } from './components/RankingTab';
import { TimeseriesTab } from './components/TimeseriesTab';
import { addDaysISO, formatJstDateISO } from '@/lib/date-utils';

interface DateRange {
  start?: string | null;
  end?: string | null;
}

type PeriodValue = '7' | '14' | '30' | '90';
type PeriodPresetValue = PeriodValue | 'custom';

const getDefaultDateRange = (): { start: string; end: string } => {
  const todayJst = formatJstDateISO(new Date());
  const end = addDaysISO(todayJst, -1);
  const start = addDaysISO(end, -29);
  return { start, end };
};

const getPeriodPresetFromRange = (range: DateRange): PeriodPresetValue => {
  if (!range.start || !range.end) {
    return '30';
  }
  const startMs = new Date(`${range.start}T00:00:00Z`).getTime();
  const endMs = new Date(`${range.end}T00:00:00Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return 'custom';
  }
  const days = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  if (days === 7 || days === 14 || days === 30 || days === 90) {
    return String(days) as PeriodValue;
  }
  return 'custom';
};

interface Props {
  initialData?: {
    summary: Ga4DashboardSummary;
    ranking: Ga4DashboardRankingItem[];
    timeseries: Ga4DashboardTimeseriesPoint[];
    initialNormalizedPath?: string;
  };
  initialError?: string;
  initialDateRange: DateRange;
}

export default function Ga4DashboardClient({
  initialData,
  initialError,
  initialDateRange,
}: Props) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState<string | undefined>(initialError);
  const [isLoading, setIsLoading] = useState(false);

  // 現在の期間
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    if (initialDateRange.start && initialDateRange.end) {
      return initialDateRange;
    }
    return getDefaultDateRange();
  });
  const [periodPreset, setPeriodPreset] = useState<PeriodPresetValue>(() =>
    getPeriodPresetFromRange(dateRange)
  );
  const [customStart, setCustomStart] = useState(dateRange.start ?? '');
  const [customEnd, setCustomEnd] = useState(dateRange.end ?? '');

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
    ctr: true,
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
  const handlePeriodChange = useCallback(
    async (value: string) => {
      if (value === 'custom') {
        setPeriodPreset('custom');
        setCustomStart(dateRange.start ?? '');
        setCustomEnd(dateRange.end ?? '');
        return;
      }
      setIsLoading(true);
      setError(undefined);

      try {
        const { end: defaultEnd } = getDefaultDateRange();
        const nextDateRange = {
          start: addDaysISO(defaultEnd, -(Number(value) - 1)),
          end: defaultEnd,
        };

        const result = await fetchGa4DashboardData(nextDateRange);
        if (!result.success || !result.data) {
          setError(result.error ?? 'データの取得に失敗しました');
          setData(undefined);
        } else {
          setData(result.data);
          setDateRange(nextDateRange);
          setSelectedNormalizedPath(result.data.initialNormalizedPath);
          setPeriodPreset(value as PeriodValue);
        }
      } catch (err) {
        console.error('[GA4 Dashboard] Period change failed:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange.end, dateRange.start]
  );

  const handleApplyCustomRange = useCallback(async () => {
    if (!customStart || !customEnd) {
      setError('開始日と終了日を入力してください');
      return;
    }
    if (customStart > customEnd) {
      setError('開始日は終了日以前の日付を指定してください');
      return;
    }

    setIsLoading(true);
    setError(undefined);
    try {
      const nextDateRange = { start: customStart, end: customEnd };
      const result = await fetchGa4DashboardData(nextDateRange);
      if (!result.success || !result.data) {
        setError(result.error ?? 'データの取得に失敗しました');
        setData(undefined);
      } else {
        setData(result.data);
        setDateRange(nextDateRange);
        setSelectedNormalizedPath(result.data.initialNormalizedPath);
        setPeriodPreset('custom');
      }
    } catch (err) {
      console.error('[GA4 Dashboard] Custom period apply failed:', err);
      setError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [customEnd, customStart]);

  // ソート変更
  const handleSortChange = useCallback(
    async (value: string) => {
      setSortKey(value as Ga4DashboardSortKey);
      setIsLoading(true);
      setError(undefined);

      try {
        const result = await fetchGa4DashboardRanking({
          start: dateRange.start ?? undefined,
          end: dateRange.end ?? undefined,
          limit: 100,
          sort: value as Ga4DashboardSortKey,
        });

        if (!result.success || !result.data) {
          setError(result.error ?? 'データの取得に失敗しました');
        } else {
          setData((prev) =>
            prev ? { ...prev, ranking: result.data! } : undefined
          );
        }
      } catch (err) {
        console.error('[GA4 Dashboard] Sort change failed:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange.start, dateRange.end]
  );

  // パージ選択（ランキング行クリック）
  const handleRowClick = useCallback(
    async (item: Ga4DashboardRankingItem) => {
      setSelectedNormalizedPath(item.normalizedPath);
      setIsLoading(true);
      setError(undefined);

      try {
        const result = await fetchGa4DashboardTimeseries({
          start: dateRange.start ?? undefined,
          end: dateRange.end ?? undefined,
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
        console.error('[GA4 Dashboard] Row click failed:', err);
        setError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    },
    [dateRange.start, dateRange.end]
  );

  // タイムシリーズメトリック切替
  const handleToggleMetric = useCallback(
    (metric: 'readRate' | 'bounceRate' | 'cvr' | 'ctr') => {
      setVisibleTimeseriesMetrics((prev) => ({
        ...prev,
        [metric]: !prev[metric],
      }));
    },
    []
  );

  const selectedPathProps =
    selectedNormalizedPath !== undefined
      ? { selectedNormalizedPath }
      : {};

  // データ取得エラー時は設定導線を表示
  if (isNotConnected) {
    return (
      <div className="w-full px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-4">
            <Link
              href="/analytics"
              className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              コンテンツ一覧に戻る
            </Link>
            <h1 className="text-3xl font-bold">Google Analytics 4 ダッシュボード</h1>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              GA4が連携されていません。設定画面からGA4連携を行ってください。
            </AlertDescription>
          </Alert>

          <div className="flex justify-center">
            <Button asChild variant="default">
              <Link href="/setup/ga4">
                <Settings className="w-4 h-4 mr-2" />
                GA4設定に移動
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-8 space-y-6">
      {/* ヘッダー */}
      <div className="space-y-4">
        <Link
          href="/analytics"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          コンテンツ一覧に戻る
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Google Analytics 4 ダッシュボード</h1>
          <Button asChild variant="outline" size="sm">
            <Link href="/setup/ga4">
              <Settings className="w-4 h-4 mr-2" />
              設定
            </Link>
          </Button>
        </div>
      </div>

      {/* 品質フラグバナー */}
      {(data?.summary.hasSampledData || data?.summary.hasPartialData) && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            期間内にサンプリングまたは一部取得が含まれているデータがあります。
            表示される数値は推計値または不完全な集計です。
          </AlertDescription>
        </Alert>
      )}

      {/* エラー表示 */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 期間フィルタ */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm text-gray-600">集計期間:</span>
        <Select
          value={periodPreset}
          onValueChange={handlePeriodChange}
          disabled={isLoading}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">直近7日</SelectItem>
            <SelectItem value="14">直近14日</SelectItem>
            <SelectItem value="30">直近30日</SelectItem>
            <SelectItem value="90">直近90日</SelectItem>
            <SelectItem value="custom">カスタム</SelectItem>
          </SelectContent>
        </Select>

        {periodPreset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
              className="w-[180px]"
              disabled={isLoading}
            />
            <span className="text-sm text-gray-500">〜</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
              className="w-[180px]"
              disabled={isLoading}
            />
            <Button onClick={handleApplyCustomRange} disabled={isLoading}>
              期間を適用
            </Button>
          </div>
        )}

        {dateRange.start && dateRange.end && (
          <span className="text-sm text-gray-600">
            {dateRange.start} 〜 {dateRange.end}
          </span>
        )}

        {isLoading && (
          <span className="text-sm text-gray-500 animate-pulse">
            読み込み中...
          </span>
        )}
      </div>

      {/* サマリーカード */}
      {data?.summary && (
        <SummaryCards summary={data.summary} isLoading={isLoading} />
      )}

      {/* タブ */}
      <Tabs defaultValue="ranking" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-12">
          <TabsTrigger value="ranking" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span>記事別ランキング</span>
          </TabsTrigger>
          <TabsTrigger value="timeseries" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span>時系列グラフ</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="mt-6 space-y-4">
          {/* ソート選択 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">ソート:</span>
            <Select
              value={sortKey}
              onValueChange={handleSortChange}
              disabled={isLoading}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sessions">セッション数</SelectItem>
                <SelectItem value="cvr">CVR</SelectItem>
                <SelectItem value="readRate">読了率</SelectItem>
                <SelectItem value="avgEngagementTimeSec">
                  平均滞在時間
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <RankingTab
            items={data?.ranking ?? []}
            isLoading={isLoading}
            {...selectedPathProps}
            onRowClick={handleRowClick}
          />
        </TabsContent>

        <TabsContent value="timeseries" className="mt-6">
          <TimeseriesTab
            data={data?.timeseries ?? []}
            isLoading={isLoading}
            {...selectedPathProps}
            visibleMetrics={visibleTimeseriesMetrics}
            onToggleMetric={handleToggleMetric}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
