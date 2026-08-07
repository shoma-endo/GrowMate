import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyCronTimeout,
  CronTimeoutError,
  defineCronDefinitions,
  defineCronObservability,
} from '@/server/lib/cron-observability';

describe('cron-observability', () => {
  afterEach(() => vi.restoreAllMocks());

  it('専用エラーに宣言したタイムアウト種別を使う', () => {
    expect(classifyCronTimeout(new CronTimeoutError('JOB_TIMEOUT', 'job timed out'))).toBe(
      'JOB_TIMEOUT'
    );
  });

  it('undiciのタイムアウトコードを上流HTTPタイムアウトとして分類する', () => {
    const error = Object.assign(new Error('request failed'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    expect(classifyCronTimeout(error)).toBe('UPSTREAM_HTTP_TIMEOUT');
  });

  it('cause内のundiciタイムアウトコードを分類する', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
    });

    expect(classifyCronTimeout(error)).toBe('UPSTREAM_HTTP_TIMEOUT');
  });

  it('複数段のcauseを探索する', () => {
    const error = Object.assign(new Error('request failed'), {
      cause: { cause: { code: 'ETIMEDOUT' } },
    });

    expect(classifyCronTimeout(error)).toBe('UPSTREAM_HTTP_TIMEOUT');
  });

  it('循環するcauseを安全に処理する', () => {
    const error = new Error('request failed') as Error & { cause?: unknown };
    error.cause = error;

    expect(classifyCronTimeout(error)).toBeUndefined();
  });

  it('明示的なtimeoutメッセージをUNKNOWN_TIMEOUTとして分類する', () => {
    expect(classifyCronTimeout(new Error('Request timed out.'))).toBe('UNKNOWN_TIMEOUT');
  });

  it('abortedだけではタイムアウトに分類しない', () => {
    expect(classifyCronTimeout(new Error('Request was aborted.'))).toBeUndefined();
  });

  it('Cron宣言から名前付きObserverを動的に生成する', () => {
    const definitions = defineCronDefinitions({
      newCron: { name: 'new_cron' },
    });

    expect(definitions.newCron.name).toBe('new_cron');
  });

  it('Cron名が重複する宣言を拒否する', () => {
    expect(() =>
      defineCronDefinitions({
        first: { name: 'duplicate' },
        second: { name: 'duplicate' },
      })
    ).toThrow('Cron definition names must be unique');
  });

  it('宣言したCron名と許可された診断項目だけを構造化ログへ出力する', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'gsc_suggestions' });

    cron.log('info', 'batch_completed', { durationMs: 123, total: 3 });

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'gsc_suggestions',
      event: 'batch_completed',
      durationMs: 123,
      total: 3,
    });
  });

  it('batch処理を開始して結果をそのまま返す', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'test_cron' });

    await expect(cron.runBatch(async startedAt => ({ startedAt }))).resolves.toEqual({
      startedAt: 100,
    });
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'test_cron',
      event: 'batch_started',
    });
  });

  it('batch例外を記録して同じ例外を再throwする', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(250);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'test_cron' });
    const originalError = new CronTimeoutError('UPSTREAM_HTTP_TIMEOUT', 'failed');

    await expect(
      cron.runBatch(async () => {
        throw originalError;
      })
    ).rejects.toBe(originalError);
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'test_cron',
      event: 'batch_failed',
      durationMs: 150,
      timeoutType: 'UPSTREAM_HTTP_TIMEOUT',
    });
  });

  it('Route失敗を共通処理でタイムアウトとして記録する', () => {
    vi.spyOn(Date, 'now').mockReturnValue(250);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'test_cron' });

    cron.logRouteFailure(new CronTimeoutError('JOB_TIMEOUT', 'timeout'), 100);

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'test_cron',
      event: 'route_timed_out',
      durationMs: 150,
      timeoutType: 'JOB_TIMEOUT',
    });
  });

  it('Routeの通常失敗をroute_failedとして記録する', () => {
    vi.spyOn(Date, 'now').mockReturnValue(250);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'test_cron' });

    cron.logRouteFailure(new Error('failed'), 100);

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'test_cron',
      event: 'route_failed',
      durationMs: 150,
    });
  });
});
