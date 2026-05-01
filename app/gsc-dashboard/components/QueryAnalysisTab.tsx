'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { Loader2, Search, ArrowUpDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchQueryAnalysis, type QueryAggregation } from '@/server/actions/gscDashboard.actions';

export interface QueryAnalysisTabProps {
  annotationId: string | null;
}

type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position' | 'positionChange';
type DateRange = '7d' | '28d' | '3m';

// 散布図用のデータ型
interface ScatterDataPoint {
  query: string;
  position: number;
  ctr: number;
  impressions: number;
  clicks: number;
  quadrant: 'winner' | 'title-fix' | 'treasure' | 'low-priority';
}

// 象限判定の閾値（市場平均データに基づく）
// - 高順位: 10位以内（1ページ目）
// - 高CTR: 3%以上（10位平均CTR 2.5%を上回る値）
const THRESHOLD_POSITION = 10;
const THRESHOLD_CTR = 3;

// 象限の色と日本語ラベル
const QUADRANT_COLORS: Record<ScatterDataPoint['quadrant'], string> = {
  winner: '#22c55e', // green-500
  'title-fix': '#eab308', // yellow-500
  treasure: '#3b82f6', // blue-500
  'low-priority': '#9ca3af', // gray-400
};

const QUADRANT_LABELS: Record<ScatterDataPoint['quadrant'], { name: string; description: string }> =
  {
    winner: {
      name: '高順位・高CTR',
      description: `${THRESHOLD_POSITION}位以内 × CTR${THRESHOLD_CTR}%以上`,
    },
    'title-fix': {
      name: '高順位・低CTR',
      description: `${THRESHOLD_POSITION}位以内 × CTR${THRESHOLD_CTR}%未満`,
    },
    treasure: {
      name: '低順位・高CTR',
      description: `${THRESHOLD_POSITION}位以下 × CTR${THRESHOLD_CTR}%以上`,
    },
    'low-priority': {
      name: '低順位・低CTR',
      description: `${THRESHOLD_POSITION}位以下 × CTR${THRESHOLD_CTR}%未満`,
    },
  };

// 象限判定
function getQuadrant(position: number, ctr: number): ScatterDataPoint['quadrant'] {
  const isHighPosition = position <= THRESHOLD_POSITION;
  const isHighCtr = ctr >= THRESHOLD_CTR;

  if (isHighPosition && isHighCtr) return 'winner';
  if (isHighPosition && !isHighCtr) return 'title-fix';
  if (!isHighPosition && isHighCtr) return 'treasure';
  return 'low-priority';
}

export function QueryAnalysisTab({ annotationId }: QueryAnalysisTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queries, setQueries] = useState<QueryAggregation[]>([]);
  const [summary, setSummary] = useState<{
    totalQueries: number;
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
  } | null>(null);

  // フィルタ状態
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('clicks');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [excludeBrand, setExcludeBrand] = useState(false);
  const [minWordCount, setMinWordCount] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange>('28d');

  // 選択されたクエリ
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  // データ取得
  const fetchData = useCallback(async () => {
    if (!annotationId) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetchQueryAnalysis(annotationId, dateRange);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'データの取得に失敗しました');
      }
      setQueries(res.data.queries);
      setSummary(res.data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
      setQueries([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [annotationId, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // フィルタ・ソート済みデータ
  const filteredQueries = useMemo(() => {
    let result = [...queries];

    // 検索フィルタ
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter(q => q.query.toLowerCase().includes(lower));
    }

    // ブランドクエリ除外（仮: 1単語クエリを除外）
    if (excludeBrand) {
      result = result.filter(q => q.wordCount > 1);
    }

    // ロングテールフィルタ
    if (minWordCount > 0) {
      result = result.filter(q => q.wordCount >= minWordCount);
    }

    // ソート
    result.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortBy) {
        case 'clicks':
          aVal = a.clicks;
          bVal = b.clicks;
          break;
        case 'impressions':
          aVal = a.impressions;
          bVal = b.impressions;
          break;
        case 'ctr':
          aVal = a.ctr;
          bVal = b.ctr;
          break;
        case 'position':
          aVal = a.position;
          bVal = b.position;
          break;
        case 'positionChange':
          aVal = a.positionChange ?? 0;
          bVal = b.positionChange ?? 0;
          break;
        default:
          return 0;
      }

      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [queries, searchText, excludeBrand, minWordCount, sortBy, sortOrder]);

  // 散布図データ
  const scatterData = useMemo<ScatterDataPoint[]>(() => {
    return filteredQueries.map(q => ({
      query: q.query,
      position: q.position,
      ctr: q.ctr * 100, // パーセンテージに変換
      impressions: q.impressions,
      clicks: q.clicks,
      quadrant: getQuadrant(q.position, q.ctr * 100),
    }));
  }, [filteredQueries]);

  // 散布図の軸範囲を動的に計算
  const chartDomains = useMemo(() => {
    if (scatterData.length === 0) {
      return { zRange: [50, 400] as [number, number], yMax: 30 };
    }

    // Z軸（バブルサイズ）: 表示回数の最小〜最大から動的に計算
    const impressions = scatterData.map(d => d.impressions);
    const minImpressions = Math.min(...impressions);
    const maxImpressions = Math.max(...impressions);

    // 対数スケールで見やすくする（最小50px、最大400px）
    // 表示回数が均一な場合は固定サイズ
    const zRange: [number, number] = maxImpressions === minImpressions ? [150, 150] : [50, 400];

    // Y軸（CTR）: 異常値をキャップ（最大50%、または95パーセンタイル+5）
    const ctrs = scatterData.map(d => d.ctr).sort((a, b) => a - b);
    const p95Index = Math.floor(ctrs.length * 0.95);
    const p95Ctr = ctrs[p95Index] ?? 30;
    const yMax = Math.min(50, Math.max(p95Ctr + 5, THRESHOLD_CTR * 2));

    return { zRange, yMax };
  }, [scatterData]);

  // ソートトグル
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder(key === 'position' ? 'asc' : 'desc');
    }
  };

  if (!annotationId) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-gray-500">
          <p>記事が選択されていません</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-20">
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin" />
            クエリデータを読み込み中...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-red-500">
          <p>{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (queries.length === 0) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-gray-500">
          <p>クエリデータがありません</p>
          <p className="text-sm mt-2">GSCからデータをインポートしてください</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* サマリーカード */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg border bg-white">
            <p className="text-xs text-gray-500 mb-1">クエリ数</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalQueries}</p>
          </div>
          <div className="p-4 rounded-lg border bg-green-50 border-green-200">
            <p className="text-xs text-gray-500 mb-1">総クリック</p>
            <p className="text-2xl font-bold text-green-700">
              {summary.totalClicks.toLocaleString()}
            </p>
          </div>
          <div className="p-4 rounded-lg border bg-fuchsia-50 border-fuchsia-200">
            <p className="text-xs text-gray-500 mb-1">総表示</p>
            <p className="text-2xl font-bold text-fuchsia-700">
              {summary.totalImpressions.toLocaleString()}
            </p>
          </div>
          <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
            <p className="text-xs text-gray-500 mb-1">平均順位</p>
            <p className="text-2xl font-bold text-blue-700">{summary.avgPosition.toFixed(1)}</p>
          </div>
        </div>
      )}

      {/* 順位×CTR分析（散布図） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">順位×CTR分析</CardTitle>
          <p className="text-sm text-gray-500">
            X軸: 掲載順位（左が高順位） | Y軸: CTR | バブルサイズ: 表示回数
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <XAxis
                  type="number"
                  dataKey="position"
                  name="掲載順位"
                  domain={[1, 'dataMax']}
                  reversed
                  tick={{ fontSize: 12 }}
                  label={{ value: '掲載順位', position: 'bottom', fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="ctr"
                  name="CTR(%)"
                  domain={[0, chartDomains.yMax]}
                  tick={{ fontSize: 12 }}
                  label={{ value: 'CTR(%)', angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <ZAxis
                  type="number"
                  dataKey="impressions"
                  range={chartDomains.zRange}
                  name="表示回数"
                />
                {/* 象限の境界線（閾値） */}
                <ReferenceLine x={THRESHOLD_POSITION} stroke="#e5e7eb" strokeDasharray="3 3" />
                <ReferenceLine y={THRESHOLD_CTR} stroke="#e5e7eb" strokeDasharray="3 3" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const data = payload[0]?.payload as ScatterDataPoint;
                    return (
                      <div className="bg-white p-3 border rounded-lg shadow-lg text-sm">
                        <p className="font-semibold mb-1 max-w-xs truncate">{data.query}</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                          <span>順位:</span>
                          <span className="font-medium">{data.position.toFixed(1)}</span>
                          <span>CTR:</span>
                          <span className="font-medium">{data.ctr.toFixed(2)}%</span>
                          <span>表示:</span>
                          <span className="font-medium">{data.impressions.toLocaleString()}</span>
                          <span>クリック:</span>
                          <span className="font-medium">{data.clicks.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter name="クエリ" data={scatterData}>
                  {scatterData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={QUADRANT_COLORS[entry.quadrant]}
                      opacity={selectedQuery === entry.query ? 1 : 0.7}
                      stroke={selectedQuery === entry.query ? '#000' : 'none'}
                      strokeWidth={selectedQuery === entry.query ? 2 : 0}
                      cursor="pointer"
                      onClick={() => setSelectedQuery(entry.query)}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {/* 凡例 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: QUADRANT_COLORS.winner }}
              />
              <span>{QUADRANT_LABELS.winner.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: QUADRANT_COLORS['title-fix'] }}
              />
              <span>{QUADRANT_LABELS['title-fix'].name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: QUADRANT_COLORS.treasure }}
              />
              <span>{QUADRANT_LABELS.treasure.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: QUADRANT_COLORS['low-priority'] }}
              />
              <span>{QUADRANT_LABELS['low-priority'].name}</span>
            </div>
          </div>
          {/* 基準の説明 */}
          <p className="text-xs text-gray-400 mt-2">
            ※ 基準: 高順位={THRESHOLD_POSITION}位以内、高CTR={THRESHOLD_CTR}%以上（10位平均CTR
            2.5%を参考）
          </p>
        </CardContent>
      </Card>

      {/* Actionable Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">検索クエリ詳細</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* フィルタ */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="クエリで絞り込み..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={dateRange} onValueChange={v => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="期間" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">過去7日</SelectItem>
                <SelectItem value="28d">過去28日</SelectItem>
                <SelectItem value="3m">過去3ヶ月</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Checkbox
                id="exclude-brand"
                checked={excludeBrand}
                onCheckedChange={checked => setExcludeBrand(checked === true)}
              />
              <label htmlFor="exclude-brand" className="text-sm cursor-pointer">
                1単語クエリを除外
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="longtail"
                checked={minWordCount >= 3}
                onCheckedChange={checked => setMinWordCount(checked ? 3 : 0)}
              />
              <label htmlFor="longtail" className="text-sm cursor-pointer">
                ロングテールのみ
              </label>
            </div>
          </div>

          {/* テーブル */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-[40%]">クエリ</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSort('clicks')}
                  >
                    <div className="flex items-center gap-1">
                      クリック
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSort('impressions')}
                  >
                    <div className="flex items-center gap-1">
                      表示
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSort('ctr')}
                  >
                    <div className="flex items-center gap-1">
                      CTR
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSort('position')}
                  >
                    <div className="flex items-center gap-1">
                      順位
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => toggleSort('positionChange')}
                  >
                    <div className="flex items-center gap-1">
                      変化
                      <ArrowUpDown className="w-3 h-3" />
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueries.slice(0, 50).map(q => {
                  const quadrant = getQuadrant(q.position, q.ctr * 100);
                  return (
                    <TableRow
                      key={q.queryNormalized}
                      className={`cursor-pointer hover:bg-gray-50 ${
                        selectedQuery === q.query ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => setSelectedQuery(q.query)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: QUADRANT_COLORS[quadrant] }}
                          />
                          <span className="truncate max-w-xs">{q.query}</span>
                        </div>
                      </TableCell>
                      <TableCell>{q.clicks.toLocaleString()}</TableCell>
                      <TableCell>{q.impressions.toLocaleString()}</TableCell>
                      <TableCell>{(q.ctr * 100).toFixed(2)}%</TableCell>
                      <TableCell>{q.position.toFixed(1)}</TableCell>
                      <TableCell>
                        {q.positionChange !== null ? (
                          <div className="flex items-center gap-1">
                            {q.positionChange < -0.5 ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : q.positionChange > 0.5 ? (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            ) : (
                              <Minus className="w-4 h-4 text-gray-400" />
                            )}
                            <span
                              className={
                                q.positionChange < -0.5
                                  ? 'text-green-600'
                                  : q.positionChange > 0.5
                                    ? 'text-red-600'
                                    : 'text-gray-500'
                              }
                            >
                              {q.positionChange > 0 ? '+' : ''}
                              {q.positionChange.toFixed(1)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {filteredQueries.length > 50 && (
            <p className="text-sm text-gray-500 text-center">
              上位50件を表示中（全{filteredQueries.length}件）
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
