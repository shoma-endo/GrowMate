import { addDaysISO } from '@/lib/date-utils';

const ANALYTICS_MAX_PERIOD_DAYS = 100;

export interface AnalyticsPeriod {
  startDate: string;
  endDate: string;
  clamped: boolean;
}

function differenceInDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('分析期間の日付が不正です');
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function clampAnalyticsPeriod(startDate: string, endDate: string): AnalyticsPeriod {
  if (!startDate || !endDate || startDate > endDate) {
    throw new Error('分析期間が不正です');
  }
  const days = differenceInDays(startDate, endDate);
  if (days <= ANALYTICS_MAX_PERIOD_DAYS) {
    return { startDate, endDate, clamped: false };
  }
  return {
    startDate: addDaysISO(endDate, -(ANALYTICS_MAX_PERIOD_DAYS - 1)),
    endDate,
    clamped: true,
  };
}
