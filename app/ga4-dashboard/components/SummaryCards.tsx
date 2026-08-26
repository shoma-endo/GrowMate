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
    // GA4 の sessions は「セッション」（§10.7 / ui-text.md）。
    // 以前は sessions を「総訪問数」、その代用値でしかない users を「セッション」と
    // 呼んでおり、正しい語が間違ったフィールドに付いていた。
    //
    // users は取込側で `const users = sessions` としているため（ga4ImportService.ts。
    // totalUsers は landingPage 軸と非互換で、CVR の分母を確保するための代用）、
    // 常に sessions と同じ数値になる。同じ数字を2枚見せる意味が無いのでカードを1枚に統合した。
    // totalUsers 自体は ga4-dashboard-mapping.ts の CVR 分母として使い続ける。
    {
      label: 'セッション',
      value: formatNumber(summary.totalSessions),
      color: 'green',
    },
    {
      label: '平均エンゲージメント時間',
      value: formatDuration(summary.avgEngagementTimeSec),
      color: 'purple',
    },
    {
      label: '総問い合わせ数',
      value: formatNumber(summary.totalCvEventCount),
      color: 'fuchsia',
    },
    {
      label: '問い合わせ率',
      value: formatPercent(summary.cvr),
      color: 'rose',
    },
    {
      label: '平均完読率',
      value: formatPercent(summary.avgReadRate),
      color: 'cyan',
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
          fuchsia: 'bg-fuchsia-50 border-fuchsia-200',
          rose: 'bg-rose-50 border-rose-200',
          cyan: 'bg-cyan-50 border-cyan-200',
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
