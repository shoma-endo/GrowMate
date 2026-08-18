export const GA4_EVALUATION_DEFAULT_DAYS = 90;

export function getGa4EvaluationDateRange(today: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - (GA4_EVALUATION_DEFAULT_DAYS - 1));
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}
