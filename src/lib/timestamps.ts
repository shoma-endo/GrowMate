export type IsoTimestamp = string & { readonly __brand: unique symbol };

const ISO_EPOCH = new Date(0).toISOString() as IsoTimestamp;

export const toIsoTimestamp = (value: string | number | Date): IsoTimestamp => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid timestamp number: ${value}`);
    }
    return new Date(value).toISOString() as IsoTimestamp;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid Date value: ${value}`);
    }
    return value.toISOString() as IsoTimestamp;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp string: "${value}"`);
  }
  return new Date(parsed).toISOString() as IsoTimestamp;
};

export const parseTimestamp = (value: string | number | null | undefined): IsoTimestamp =>
  parseTimestampSafe(value, ISO_EPOCH);

export const parseTimestampOrNull = (
  value: string | number | null | undefined
): IsoTimestamp | null => {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return toIsoTimestamp(value);
  } catch {
    return null;
  }
};

export const parseTimestampStrict = (value: string | number | null | undefined): IsoTimestamp => {
  if (value === null || value === undefined) {
    throw new Error(`Null or undefined timestamp received: ${String(value)}`);
  }
  return toIsoTimestamp(value);
};

export const parseTimestampSafe = (
  value: string | number | null | undefined,
  fallback: IsoTimestamp = ISO_EPOCH
): IsoTimestamp => {
  try {
    return parseTimestampStrict(value);
  } catch {
    return fallback;
  }
};

export function generateOrderedTimestamps(
  count: 1,
  baseTime?: Date
): [IsoTimestamp];
export function generateOrderedTimestamps(
  count: 2,
  baseTime?: Date
): [IsoTimestamp, IsoTimestamp];
export function generateOrderedTimestamps(
  count: 3,
  baseTime?: Date
): [IsoTimestamp, IsoTimestamp, IsoTimestamp];
export function generateOrderedTimestamps(
  count: number,
  baseTime?: Date
): IsoTimestamp[];
export function generateOrderedTimestamps(
  count: number,
  baseTime: Date = new Date()
): IsoTimestamp[] {
  const MAX_COUNT = 10000;
  if (!Number.isInteger(count) || count <= 0 || count > MAX_COUNT) {
    throw new Error(`Invalid count for ordered timestamps: ${count}`);
  }
  if (Number.isNaN(baseTime.getTime())) {
    throw new Error(`Invalid base time for ordered timestamps: ${baseTime}`);
  }
  const baseMs = baseTime.getTime();
  return Array.from({ length: count }, (_, index) => toIsoTimestamp(baseMs + index));
}
