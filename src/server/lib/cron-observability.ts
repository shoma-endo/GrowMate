export type CronTimeoutType =
  | 'LLM_TIMEOUT'
  | 'JOB_TIMEOUT'
  | 'CRON_TIME_BUDGET_EXCEEDED'
  | 'UPSTREAM_HTTP_TIMEOUT'
  | 'DATABASE_TIMEOUT'
  | 'UNKNOWN_TIMEOUT';

type CronLogLevel = 'info' | 'warn' | 'error';
type CronEvent =
  | 'batch_started'
  | 'batch_completed'
  | 'batch_failed'
  | 'batch_time_budget_exceeded'
  | 'job_failed'
  | 'job_discarded'
  | 'job_timed_out'
  | 'job_time_budget_exceeded'
  | 'route_failed'
  | 'route_timed_out';

interface CronLogDetails {
  durationMs?: number;
  timeoutType?: CronTimeoutType;
  operation?: string;
  attempt?: number;
  total?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  remaining?: number;
}

interface CronDefinition<Name extends string> {
  name: Name;
}

interface CronObserver<Name extends string> {
  readonly name: Name;
  log(level: CronLogLevel, event: CronEvent, details?: CronLogDetails): void;
  runBatch<Result>(task: (startedAt: number) => Promise<Result>): Promise<Result>;
  logRouteFailure(error: unknown, startedAt: number): void;
}

const TIMEOUT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const MAX_ERROR_CAUSE_DEPTH = 5;

export class CronTimeoutError extends Error {
  constructor(
    readonly timeoutType: CronTimeoutType,
    message: string
  ) {
    super(message);
    this.name = 'CronTimeoutError';
  }
}

export function classifyCronTimeout(error: unknown): CronTimeoutType | undefined {
  if (error instanceof CronTimeoutError) return error.timeoutType;
  if (!isObject(error)) return undefined;

  if (findKnownTimeoutCode(error)) return 'UPSTREAM_HTTP_TIMEOUT';

  const message =
    'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (message.includes('database') && message.includes('timeout')) return 'DATABASE_TIMEOUT';
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'UNKNOWN_TIMEOUT';
  }
  return undefined;
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function findKnownTimeoutCode(error: Record<PropertyKey, unknown>): string | undefined {
  const visited = new Set<object>();
  let current: Record<PropertyKey, unknown> | undefined = error;

  for (let depth = 0; current && depth <= MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (visited.has(current)) return undefined;
    visited.add(current);

    const code = typeof current.code === 'string' ? current.code : undefined;
    if (code && TIMEOUT_ERROR_CODES.has(code)) return code;
    current = isObject(current.cause) ? current.cause : undefined;
  }

  return undefined;
}

export function defineCronObservability<const Name extends string>(
  definition: CronDefinition<Name>
): CronObserver<Name> {
  const log = (level: CronLogLevel, event: CronEvent, details: CronLogDetails = {}): void => {
    console[level](JSON.stringify({ source: 'cron', cron: definition.name, event, ...details }));
  };

  return {
    name: definition.name,
    log,
    async runBatch<Result>(task: (startedAt: number) => Promise<Result>): Promise<Result> {
      const startedAt = Date.now();
      log('info', 'batch_started');
      try {
        return await task(startedAt);
      } catch (error) {
        const timeoutType = classifyCronTimeout(error);
        log('error', 'batch_failed', {
          durationMs: Date.now() - startedAt,
          ...(timeoutType ? { timeoutType } : {}),
        });
        throw error;
      }
    },
    logRouteFailure(error: unknown, startedAt: number): void {
      const timeoutType = classifyCronTimeout(error);
      log('error', timeoutType ? 'route_timed_out' : 'route_failed', {
        durationMs: Date.now() - startedAt,
        ...(timeoutType ? { timeoutType } : {}),
      });
    },
  };
}

export function defineCronDefinitions<
  const Definitions extends Record<string, CronDefinition<string>>,
>(
  definitions: Definitions
): {
  [Key in keyof Definitions]: Definitions[Key] extends CronDefinition<infer Name>
    ? CronObserver<Name>
    : never;
} {
  const names = Object.values(definitions).map(definition => definition.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Cron definition names must be unique');
  }

  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [key, defineCronObservability(definition)])
  ) as {
    [Key in keyof Definitions]: Definitions[Key] extends CronDefinition<infer Name>
      ? CronObserver<Name>
      : never;
  };
}
