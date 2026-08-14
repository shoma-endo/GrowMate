export interface InstagramRateUsage {
  appUsage: { callCount: number | null; totalTime: number | null; totalCpuTime: number | null };
  bucUsage: Record<string, unknown> | null;
}

const EMPTY_USAGE: InstagramRateUsage = {
  appUsage: { callCount: null, totalTime: null, totalCpuTime: null },
  bucUsage: null,
};

function parseUsageHeader(raw: string | null): { call_count?: number } | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as { call_count?: number };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseInstagramRateUsage(headers: Headers): InstagramRateUsage {
  const appRaw = headers.get('X-App-Usage');
  const bucRaw = headers.get('X-Business-Use-Case-Usage');
  const appParsed = parseUsageHeader(appRaw);
  let bucUsage: Record<string, unknown> | null = null;
  if (bucRaw) {
    try {
      const parsed: unknown = JSON.parse(bucRaw);
      if (typeof parsed === 'object' && parsed !== null) {
        bucUsage = parsed as Record<string, unknown>;
      }
    } catch {
      bucUsage = null;
    }
  }

  const callCount =
    typeof appParsed?.call_count === 'number' && Number.isFinite(appParsed.call_count)
      ? appParsed.call_count
      : null;

  return {
    appUsage: {
      callCount,
      totalTime: null,
      totalCpuTime: null,
    },
    bucUsage,
  };
}

export function hasExceededInstagramRateThreshold(
  usage: InstagramRateUsage,
  threshold: number
): boolean {
  const callCount = usage.appUsage.callCount;
  if (callCount == null) {
    return false;
  }
  return callCount >= threshold;
}

export function mergeInstagramRateUsage(
  current: InstagramRateUsage,
  next: InstagramRateUsage
): InstagramRateUsage {
  const callCount = next.appUsage.callCount ?? current.appUsage.callCount;
  return {
    appUsage: {
      callCount,
      totalTime: next.appUsage.totalTime ?? current.appUsage.totalTime,
      totalCpuTime: next.appUsage.totalCpuTime ?? current.appUsage.totalCpuTime,
    },
    bucUsage: next.bucUsage ?? current.bucUsage,
  };
}

export { EMPTY_USAGE as emptyInstagramRateUsage };
