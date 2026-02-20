'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { Ga4DashboardTimeseriesPoint } from '@/types/ga4';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TimeseriesMetric {
  readRate: boolean;
  bounceRate: boolean;
  cvr: boolean;
  ctr: boolean;
}

interface Props {
  data: Ga4DashboardTimeseriesPoint[];
  isLoading?: boolean;
  selectedNormalizedPath?: string;
  visibleMetrics: TimeseriesMetric;
  onToggleMetric: (metric: 'readRate' | 'bounceRate' | 'cvr' | 'ctr') => void;
}

export function TimeseriesTab({
  data,
  isLoading,
  selectedNormalizedPath,
  visibleMetrics,
  onToggleMetric,
}: Props) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const formatNumber = (num: number) => num.toLocaleString();
  const formatPercent = (num: number | null) => num === null ? '-' : `${num.toFixed(1)}%`;

  // セッション・ユーザー用のYAxisドメイン
  const sessionsDomain = data.length > 0
    ? [0, Math.max(...data.map((d) => d.sessions)) * 1.1]
    : [0, 100];

  // パーセント用のYAxisドメイン（CTR>100%のケースもクリップしない）
  const percentValues = data.flatMap((d) => {
    const values: number[] = [];
    if (visibleMetrics.readRate) values.push(d.readRate);
    if (visibleMetrics.bounceRate) values.push(d.bounceRate * 100);
    if (visibleMetrics.cvr) values.push(d.cvr);
    if (visibleMetrics.ctr && d.ctr !== null) values.push(d.ctr * 100);
    return values;
  });
  const maxPercentValue = percentValues.length > 0 ? Math.max(...percentValues) : 100;
  const percentDomainMax = Math.max(100, Math.ceil(maxPercentValue * 1.1 / 10) * 10);
  const percentDomain = [0, percentDomainMax];

  // カスタムTooltip
  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ value: number; name: string; payload: Ga4DashboardTimeseriesPoint }>;
  }) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }

    const data = payload[0]?.payload as Ga4DashboardTimeseriesPoint;
    if (!data) return null;

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 space-y-2">
        <div className="text-sm font-medium text-gray-900 border-b pb-1 mb-2">
          {data.date}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-gray-600">セッション:</div>
          <div className="text-right font-medium">{formatNumber(data.sessions)}</div>

          <div className="text-gray-600">ユーザー数:</div>
          <div className="text-right font-medium">{formatNumber(data.users)}</div>

          <div className="text-gray-600">平均滞在時間:</div>
          <div className="text-right font-medium">
            {Math.round(data.avgEngagementTimeSec)}秒
          </div>

          <div className="text-gray-600">直帰率:</div>
          <div className="text-right font-medium">
            {formatPercent(data.bounceRate * 100)}
          </div>

          <div className="text-gray-600">CVR:</div>
          <div className="text-right font-medium">{formatPercent(data.cvr)}</div>

          <div className="text-gray-600">読了率:</div>
          <div className="text-right font-medium">{formatPercent(data.readRate)}</div>

          <div className="text-gray-600">CTR:</div>
          <div className="text-right font-medium">{formatPercent(data.ctr !== null ? data.ctr * 100 : null)}</div>
        </div>

        {(data.isSampled || data.isPartial) && (
          <div className="pt-2 border-t flex gap-1 flex-wrap">
            {data.isSampled && (
              <Badge variant="secondary" className="text-xs">
                サンプリング
              </Badge>
            )}
            {data.isPartial && (
              <Badge variant="outline" className="text-xs">
                一部取得
              </Badge>
            )}
          </div>
        )}
      </div>
    );
  };

  if (data.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12 text-gray-500">
        {selectedNormalizedPath ? (
          <>
            <p className="mb-2">
              選択されたパスの時系列データがありません。
            </p>
            <p className="text-sm">
              パス: {selectedNormalizedPath}
            </p>
          </>
        ) : (
          '記事を選択すると時系列グラフが表示されます。'
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', isLoading && 'opacity-50 pointer-events-none')}>
      {/* メトリック切替ボタン */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">追加指標:</span>

        <Button
          type="button"
          variant={visibleMetrics.readRate ? 'default' : 'outline'}
          size="sm"
          onClick={() => onToggleMetric('readRate')}
          className="text-xs"
        >
          読了率
        </Button>

        <Button
          type="button"
          variant={visibleMetrics.bounceRate ? 'default' : 'outline'}
          size="sm"
          onClick={() => onToggleMetric('bounceRate')}
          className="text-xs"
        >
          直帰率
        </Button>

        <Button
          type="button"
          variant={visibleMetrics.cvr ? 'default' : 'outline'}
          size="sm"
          onClick={() => onToggleMetric('cvr')}
          className="text-xs"
        >
          CVR
        </Button>

        <Button
          type="button"
          variant={visibleMetrics.ctr ? 'default' : 'outline'}
          size="sm"
          onClick={() => onToggleMetric('ctr')}
          className="text-xs"
        >
          CTR
        </Button>
      </div>

      {/* 選択中のパス表示 */}
      {selectedNormalizedPath && (
        <div className="text-sm text-gray-600 truncate bg-gray-50 px-3 py-2 rounded">
          <span className="font-medium">選択中:</span> {selectedNormalizedPath}
        </div>
      )}

      {/* グラフ */}
      <div className="h-80 w-full border border-gray-200 rounded-lg p-4">
        {data.length > 0 ? (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />

              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 12 }}
                tickMargin={10}
                stroke="#6b7280"
              />

              {/* 左側YAxis: セッション・ユーザー */}
              <YAxis
                yAxisId="sessions"
                domain={sessionsDomain}
                tick={{ fontSize: 12 }}
                tickFormatter={formatNumber}
                stroke="#6b7280"
              />

              {/* 右側YAxis: パーセント */}
              <YAxis
                yAxisId="percent"
                orientation="right"
                domain={percentDomain}
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => `${value}%`}
                stroke="#6b7280"
              />

              <Tooltip content={<CustomTooltip />} />

              <Legend
                verticalAlign="top"
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: 12 }}
              />

              {/* セッション（常時表示） */}
              <Line
                yAxisId="sessions"
                type="monotone"
                dataKey="sessions"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="セッション"
                connectNulls={false}
              />

              {/* ユーザー（常時表示） */}
              <Line
                yAxisId="sessions"
                type="monotone"
                dataKey="users"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="ユーザー数"
                connectNulls={false}
              />

              {/* 読了率（切替） */}
              {visibleMetrics.readRate && (
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey="readRate"
                  stroke="#0891b2"
                  strokeWidth={2}
                  dot={false}
                  name="読了率(%)"
                  connectNulls={false}
                />
              )}

              {/* 直帰率（切替） */}
              {visibleMetrics.bounceRate && (
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey={(d) => d.bounceRate * 100}
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  name="直帰率(%)"
                  connectNulls={false}
                />
              )}

              {/* CVR（切替） */}
              {visibleMetrics.cvr && (
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey="cvr"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={false}
                  name="CVR(%)"
                  connectNulls={false}
                />
              )}

              {/* CTR（切替） */}
              {visibleMetrics.ctr && (
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey={(d) => d.ctr !== null ? d.ctr * 100 : null}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  name="CTR(%)"
                  connectNulls={false}
                />
              )}

              {/* サンプリング/一部取得の日の参考線 */}
              {data.some((d) => d.isSampled || d.isPartial) && (
                <ReferenceLine
                  y={0}
                  yAxisId="sessions"
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                />
              )}

              {/* 100%基準線（CTRが100%を超える日の視認性向上） */}
              <ReferenceLine
                y={100}
                yAxisId="percent"
                stroke="#94a3b8"
                strokeDasharray="3 3"
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            データがありません
          </div>
        )}
      </div>

      {/* 注釈 */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        <ul className="list-disc list-inside space-y-1">
          <li>グラフをクリック/ドラッグして拡大できます</li>
          <li>
            凡例の切り替えボタンで追加指標の表示/非表示を切り替えられます
          </li>
        </ul>
      </div>
    </div>
  );
}
