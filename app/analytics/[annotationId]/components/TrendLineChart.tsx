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
} from 'recharts';
import type { GscChartDataPoint, GscVisibleMetrics } from '../types';

export interface TrendLineChartProps {
  data: GscChartDataPoint[];
  visibleMetrics: GscVisibleMetrics;
}

export function TrendLineChart({ data, visibleMetrics }: TrendLineChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-80 w-full flex items-center justify-center text-gray-400">
        データがありません
      </div>
    );
  }

  return (
    <div className="h-80 w-full mt-4">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={10} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              borderRadius: '8px',
              border: 'none',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
          />
          <Legend />
          {visibleMetrics.clicks && (
            <Line
              type="monotone"
              dataKey="clicks"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              name="クリック"
            />
          )}
          {visibleMetrics.impressions && (
            <Line
              type="monotone"
              dataKey="impressions"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
              name="表示回数"
            />
          )}
          {visibleMetrics.ctr && (
            <Line
              type="monotone"
              dataKey="ctr"
              stroke="#fb923c"
              strokeWidth={2}
              dot={false}
              name="CTR(%)"
            />
          )}
          {visibleMetrics.position && (
            <Line
              type="monotone"
              dataKey="position"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="掲載順位"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

