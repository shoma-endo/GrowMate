import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: { insertCronRunLog: vi.fn() },
}));

import { after } from 'next/server';
import { SupabaseService } from '@/server/services/supabaseService';
import { defineCronObservability } from '@/server/lib/cron-observability';

const insertCronRunLog = vi.mocked(SupabaseService.insertCronRunLog);
const scheduleAfter = vi.mocked(after);

describe('cron-observability persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VERCEL_ENV', undefined);
    scheduleAfter.mockImplementation(() => undefined);
    insertCronRunLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('records the cron row at log time and preserves the console payload', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'gsc_suggestions' });

    cron.log('info', 'batch_completed', { durationMs: 1500, total: 3 });

    expect(scheduleAfter).toHaveBeenCalledOnce();
    expect(scheduleAfter.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'gsc_suggestions',
      event: 'batch_completed',
      durationMs: 1500,
      total: 3,
    });
    await vi.waitFor(() => expect(insertCronRunLog).toHaveBeenCalledOnce());
    expect(insertCronRunLog).toHaveBeenCalledWith({
      cron_name: 'gsc_suggestions',
      event: 'batch_completed',
      level: 'info',
      logged_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      details: { durationMs: 1500, total: 3 },
      environment: 'local',
    });
  });

  it.each([
    ['production', 'production'],
    ['preview', 'preview'],
    ['development', 'local'],
    [undefined, 'local'],
  ] as const)('maps VERCEL_ENV %s to %s', async (vercelEnv, expectedEnvironment) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    defineCronObservability({ name: 'test_cron' }).log('warn', 'batch_started');

    await vi.waitFor(() => expect(insertCronRunLog).toHaveBeenCalledOnce());
    expect(insertCronRunLog.mock.calls[0]?.[0].environment).toBe(expectedEnvironment);
  });

  it('persists only the ten supported detail keys', async () => {
    const cron = defineCronObservability({ name: 'test_cron' });

    cron.log(
      'info',
      'batch_completed',
      { durationMs: 10, message: 'private detail' } as Parameters<typeof cron.log>[2]
    );

    await vi.waitFor(() => expect(insertCronRunLog).toHaveBeenCalledOnce());
    expect(insertCronRunLog.mock.calls[0]?.[0].details).toStrictEqual({ durationMs: 10 });
  });

  it('does not persist the thrown exception message or stack', async () => {
    const cron = defineCronObservability({ name: 'test_cron' });

    await expect(
      cron.runBatch(async () => {
        throw new Error('secret message');
      })
    ).rejects.toThrow('secret message');

    await vi.waitFor(() => expect(insertCronRunLog).toHaveBeenCalled());
    const savedRows = JSON.stringify(insertCronRunLog.mock.calls.map(([row]) => row));
    expect(savedRows).not.toContain('secret message');
    expect(savedRows).not.toContain('stack');
  });

  it('starts insertion without waiting for it or changing the void return', async () => {
    insertCronRunLog.mockReturnValue(new Promise<void>(() => undefined));
    const cron = defineCronObservability({ name: 'test_cron' });

    expect(cron.log('info', 'batch_started')).toBeUndefined();
    await vi.waitFor(() => expect(insertCronRunLog).toHaveBeenCalledOnce());

    const scheduled = scheduleAfter.mock.calls[0]?.[0];
    expect(scheduled).toBeInstanceOf(Promise);
    let resolved = false;
    if (scheduled instanceof Promise) void scheduled.then(() => (resolved = true));
    await Promise.resolve();
    expect(resolved).toBe(false);
  });

  it('logs a fixed error and resolves the after promise when insertion fails', async () => {
    insertCronRunLog.mockRejectedValue(new Error('insert failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defineCronObservability({ name: 'test_cron' }).log('info', 'batch_started');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[cron-observability] Failed to persist cron log',
        expect.any(Error)
      )
    );
    await expect(scheduleAfter.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it('does not start insertion or expose an after registration error', () => {
    scheduleAfter.mockImplementation(() => {
      throw new Error('not in request');
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cron = defineCronObservability({ name: 'test_cron' });

    expect(() => cron.log('info', 'batch_started')).not.toThrow();

    expect(insertCronRunLog).not.toHaveBeenCalled();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toStrictEqual({
      source: 'cron',
      cron: 'test_cron',
      event: 'batch_started',
    });
    expect(error).not.toHaveBeenCalled();
  });
});
