import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatError, ChatErrorCode } from '@/domain/errors/ChatError';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  generate: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        update: vi.fn(() => query),
        eq: vi.fn(() => query),
        select: vi.fn(() => query),
        maybeSingle: mocks.maybeSingle,
      };
      return { rpc: mocks.rpc, from: vi.fn(() => query) };
    }
  },
}));

vi.mock('@/server/services/gscSuggestionService', () => ({
  gscSuggestionService: { generate: mocks.generate },
}));

import { gscSuggestionJobService } from '@/server/services/gscSuggestionJobService';

describe('gscSuggestionJobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1回の実行で最大3件をclaimする', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(gscSuggestionJobService.runNextJobs()).resolves.toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      terminalFailed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_gsc_suggestion_jobs', { p_limit: 3 });
  });

  it('claim失敗をbatch_failedとして記録して再throwする', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'claim failed' } });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(gscSuggestionJobService.runNextJobs()).rejects.toThrow('claim failed');
    expect(
      error.mock.calls
        .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
        .map(log => log.event)
    ).toContain('batch_failed');
  });

  it('3回目の失敗をterminalFailedとして集計する', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'history-id',
          user_id: 'user-id',
          content_annotation_id: 'annotation-id',
          outcome: 'no_change',
          current_position: 10,
          previous_position: 10,
          suggestion_stage: 3,
          suggestion_attempt_count: 3,
          suggestion_job_token: 'job-token',
        },
      ],
      error: null,
    });
    mocks.generate.mockRejectedValue(new Error('Request was aborted.'));
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'history-id' }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(gscSuggestionJobService.runNextJobs()).resolves.toEqual({
      total: 1,
      completed: 0,
      failed: 1,
      terminalFailed: 1,
    });
  });

  it('LLMのChatErrorをLLM_TIMEOUTとして構造化ログへ記録する', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'history-id',
          user_id: 'user-id',
          content_annotation_id: 'annotation-id',
          outcome: 'no_change',
          current_position: 10,
          previous_position: 10,
          suggestion_stage: 3,
          suggestion_attempt_count: 1,
          suggestion_job_token: 'job-token',
        },
      ],
      error: null,
    });
    mocks.generate.mockRejectedValue(
      new ChatError('request timeout', ChatErrorCode.CONNECTION_TIMEOUT)
    );
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'history-id' }, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await gscSuggestionJobService.runNextJobs();

    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      source: 'cron',
      cron: 'gsc_suggestions',
      event: 'job_timed_out',
      timeoutType: 'LLM_TIMEOUT',
    });
  });

  it('discardedジョブを完了ログのskippedへ計上する', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'history-id',
          user_id: 'user-id',
          content_annotation_id: 'annotation-id',
          outcome: 'no_change',
          current_position: 10,
          previous_position: 10,
          suggestion_stage: 3,
          suggestion_attempt_count: 1,
          suggestion_job_token: 'stale-job-token',
        },
      ],
      error: null,
    });
    mocks.generate.mockResolvedValue(undefined);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(gscSuggestionJobService.runNextJobs()).resolves.toEqual({
      total: 1,
      completed: 0,
      failed: 0,
      terminalFailed: 0,
    });
    const completedLog = info.mock.calls
      .map(call => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find(log => log.event === 'batch_completed');

    expect(completedLog).toMatchObject({
      total: 1,
      succeeded: 0,
      failed: 0,
      skipped: 1,
    });
  });
});
