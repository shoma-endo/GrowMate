'use client';

import type { GscMetricsSummary, GscVisibleMetrics } from '../types';

interface MetricsSummaryCardsProps {
  summary: GscMetricsSummary;
  visibleMetrics: GscVisibleMetrics;
  onToggle: (key: keyof GscVisibleMetrics) => void;
}

export function MetricsSummaryCards({
  summary,
  visibleMetrics,
  onToggle,
}: MetricsSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 select-none">
      <div
        className={`p-4 rounded-lg border cursor-pointer transition-all ${
          visibleMetrics.clicks
            ? 'bg-green-50 border-green-500 ring-1 ring-green-500 shadow-sm'
            : 'bg-white border-gray-200 hover:border-green-300'
        }`}
        onClick={() => onToggle('clicks')}
      >
        <p className="text-xs text-gray-500 mb-1">合計クリック数</p>
        <p className="text-2xl font-bold text-gray-900">{summary.clicks.toLocaleString()}</p>
      </div>

      <div
        className={`p-4 rounded-lg border cursor-pointer transition-all ${
          visibleMetrics.impressions
            ? 'bg-fuchsia-50 border-fuchsia-500 ring-1 ring-fuchsia-500 shadow-sm'
            : 'bg-white border-gray-200 hover:border-fuchsia-300'
        }`}
        onClick={() => onToggle('impressions')}
      >
        <p className="text-xs text-gray-500 mb-1">合計表示回数</p>
        <p className="text-2xl font-bold text-gray-900">{summary.impressions.toLocaleString()}</p>
      </div>

      <div
        className={`p-4 rounded-lg border cursor-pointer transition-all ${
          visibleMetrics.ctr
            ? 'bg-orange-50 border-orange-500 ring-1 ring-orange-500 shadow-sm'
            : 'bg-white border-gray-200 hover:border-orange-300'
        }`}
        onClick={() => onToggle('ctr')}
      >
        <p className="text-xs text-gray-500 mb-1">平均 CTR</p>
        <p className="text-2xl font-bold text-gray-900">{(summary.ctr * 100).toFixed(1)}%</p>
      </div>

      <div
        className={`p-4 rounded-lg border cursor-pointer transition-all ${
          visibleMetrics.position
            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500 shadow-sm'
            : 'bg-white border-gray-200 hover:border-blue-300'
        }`}
        onClick={() => onToggle('position')}
      >
        <p className="text-xs text-gray-500 mb-1">平均掲載順位</p>
        <p className="text-2xl font-bold text-gray-900">{summary.position.toFixed(1)}</p>
      </div>
    </div>
  );
}

