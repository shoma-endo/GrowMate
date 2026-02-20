'use client';

import type { Ga4DashboardSummary } from '@/types/ga4';

interface Props {
  summary: Ga4DashboardSummary;
  isLoading?: boolean;
}

export function SummaryCards({ summary, isLoading }: Props) {
  // 数値をフォーマット
  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const formatPercent = (num: number | null) => {
    if (num === null) return '-';
    return `${num.toFixed(1)}%`;
  };

  const formatDuration = (sec: number) => {
    if (sec === 0) return '0秒';
    const avgSec = Math.round(sec);
    if (avgSec < 60) return `${avgSec}秒`;
    const min = Math.floor(avgSec / 60);
    const remainSec = avgSec % 60;
    return remainSec > 0 ? `${min}分${remainSec}秒` : `${min}分`;
  };

  const cards = [
    {
      label: '総セッション数',
      value: formatNumber(summary.totalSessions),
      color: 'green',
    },
    {
      label: '総ユーザー数',
      value: formatNumber(summary.totalUsers),
      color: 'blue',
    },
    {
      label: '平均滞在時間',
      value: formatDuration(summary.avgEngagementTimeSec),
      color: 'purple',
    },
    {
      label: '平均直帰率',
      value: formatPercent(summary.avgBounceRate * 100),
      color: 'orange',
    },
    {
      label: '総CV数',
      value: formatNumber(summary.totalCvEventCount),
      color: 'fuchsia',
    },
    {
      label: 'CVR',
      value: formatPercent(summary.cvr),
      color: 'rose',
    },
    {
      label: '平均読了率',
      value: formatPercent(summary.avgReadRate),
      color: 'cyan',
    },
    {
      label: 'インプレッション数',
      value: formatNumber(summary.totalImpressions),
      color: 'indigo',
    },
    {
      label: '検索クリック数',
      value: formatNumber(summary.totalSearchClicks),
      color: 'sky',
    },
    {
      label: 'CTR',
      value: formatPercent(summary.ctr !== null ? summary.ctr * 100 : null),
      color: 'amber',
    },
  ] as const;

  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 ${
        isLoading ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      {cards.map((card) => {
        const colorClasses = {
          green: 'bg-green-50 border-green-200',
          blue: 'bg-blue-50 border-blue-200',
          purple: 'bg-purple-50 border-purple-200',
          orange: 'bg-orange-50 border-orange-200',
          fuchsia: 'bg-fuchsia-50 border-fuchsia-200',
          rose: 'bg-rose-50 border-rose-200',
          cyan: 'bg-cyan-50 border-cyan-200',
          indigo: 'bg-indigo-50 border-indigo-200',
          sky: 'bg-sky-50 border-sky-200',
          amber: 'bg-amber-50 border-amber-200',
        };

        return (
          <div
            key={card.label}
            className={`p-4 rounded-lg border ${colorClasses[card.color]}`}
          >
            <p className="text-xs text-gray-600 mb-1">{card.label}</p>
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}
