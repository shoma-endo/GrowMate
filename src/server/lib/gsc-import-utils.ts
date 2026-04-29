type QuerySummary = {
  fetchedRows: number;
  keptRows: number;
  dedupedRows: number;
  fetchErrorPages: number;
  skipped: {
    missingKeys: number;
    invalidUrl: number;
    emptyQuery: number;
    zeroMetrics: number;
  };
  hitLimit: boolean;
};

type ImportSegmentResult = {
  totalFetched: number;
  upserted: number;
  skipped: number;
  unmatched?: number;
  querySummary?: QuerySummary;
};

type ImportAggregate = {
  totalFetched: number;
  upserted: number;
  skipped: number;
  unmatched: number;
  evaluated: number;
  segmentCount: number;
  querySummary: QuerySummary;
};

const createEmptyQuerySummary = (): QuerySummary => ({
  fetchedRows: 0,
  keptRows: 0,
  dedupedRows: 0,
  fetchErrorPages: 0,
  skipped: {
    missingKeys: 0,
    invalidUrl: 0,
    emptyQuery: 0,
    zeroMetrics: 0,
  },
  hitLimit: false,
});

export const aggregateImportResults = (
  results: ImportSegmentResult[],
  segmentCount: number
): ImportAggregate => {
  const querySummary = createEmptyQuerySummary();

  const aggregate: ImportAggregate = {
    totalFetched: 0,
    upserted: 0,
    skipped: 0,
    unmatched: 0,
    evaluated: 0,
    segmentCount,
    querySummary,
  };

  for (const result of results) {
    aggregate.totalFetched += result.totalFetched;
    aggregate.upserted += result.upserted;
    aggregate.skipped += result.skipped;
    aggregate.unmatched += result.unmatched ?? 0;

    if (result.querySummary) {
      aggregate.querySummary.fetchedRows += result.querySummary.fetchedRows;
      aggregate.querySummary.keptRows += result.querySummary.keptRows;
      aggregate.querySummary.dedupedRows += result.querySummary.dedupedRows;
      aggregate.querySummary.fetchErrorPages += result.querySummary.fetchErrorPages;
      aggregate.querySummary.skipped.missingKeys += result.querySummary.skipped.missingKeys;
      aggregate.querySummary.skipped.invalidUrl += result.querySummary.skipped.invalidUrl;
      aggregate.querySummary.skipped.emptyQuery += result.querySummary.skipped.emptyQuery;
      aggregate.querySummary.skipped.zeroMetrics += result.querySummary.skipped.zeroMetrics;
      aggregate.querySummary.hitLimit ||= result.querySummary.hitLimit;
    }
  }

  return aggregate;
};

export const splitRangeByDays = (
  startIso: string,
  endIso: string,
  segmentDays: number
): Array<{ start: string; end: string }> => {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  const ranges: Array<{ start: string; end: string }> = [];

  let cursor = new Date(start);
  while (cursor <= end) {
    const segmentStart = new Date(cursor);
    const segmentEnd = new Date(cursor);
    segmentEnd.setUTCDate(segmentEnd.getUTCDate() + segmentDays - 1);
    if (segmentEnd > end) {
      segmentEnd.setTime(end.getTime());
    }

    ranges.push({
      start: segmentStart.toISOString().slice(0, 10),
      end: segmentEnd.toISOString().slice(0, 10),
    });

    cursor = new Date(segmentEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ranges;
};
