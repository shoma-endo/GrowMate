export interface GraphInsightValue {
  name?: string;
  values?: Array<{ value?: number | Record<string, unknown>; end_time?: string }>;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseInsightRawValue(rawValue: unknown): number | null {
  if (typeof rawValue === 'number') {
    return rawValue;
  }
  if (typeof rawValue === 'object' && rawValue !== null && 'value' in rawValue) {
    return parseNumber((rawValue as { value?: unknown }).value);
  }
  return parseNumber(rawValue);
}

export function extractInsightMetric(values: GraphInsightValue[], metricName: string): number | null {
  const metric = values.find(item => item.name === metricName);
  return parseInsightRawValue(metric?.values?.[0]?.value);
}

/** period=day の end_time は対象日の終端を指すため、日付キーは前日に揃える */
export function insightEndTimeToDateKey(endTime: string): string | null {
  const parsed = new Date(endTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function extractInsightDailySeries(
  values: GraphInsightValue[],
  metricName: string
): Array<{ date: string; value: number | null }> {
  const metric = values.find(item => item.name === metricName);
  const metricValues = metric?.values;
  if (!metricValues || metricValues.length === 0) {
    return [];
  }

  const rows: Array<{ date: string; value: number | null }> = [];
  for (const entry of metricValues) {
    const endTime = entry.end_time;
    if (typeof endTime !== 'string') {
      continue;
    }
    const date = insightEndTimeToDateKey(endTime);
    if (!date) {
      continue;
    }
    rows.push({ date, value: parseInsightRawValue(entry.value) });
  }
  return rows;
}
