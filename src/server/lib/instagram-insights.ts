export interface GraphInsightValue {
  name?: string;
  values?: Array<{ value?: number | Record<string, unknown> }>;
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

export function extractLatestInsightMetric(
  values: GraphInsightValue[],
  metricName: string
): number | null {
  const metric = values.find(item => item.name === metricName);
  const metricValues = metric?.values;
  if (!metricValues || metricValues.length === 0) {
    return null;
  }
  return parseInsightRawValue(metricValues[metricValues.length - 1]?.value);
}
