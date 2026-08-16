import { describe, expect, it } from 'vitest';

import {
  applyGa4EvaluationFailure,
  resolveGa4EvaluationDisplayStatus,
} from '@/server/lib/ga4-evaluation-status';

describe('ga4-evaluation-status', () => {
  it('Kill Switch停止を最優先し、次に再認証、評価中、永続状態を表示する', () => {
    expect(
      resolveGa4EvaluationDisplayStatus({
        killSwitchEnabled: false,
        needsReauth: true,
        persistedStatus: 'evaluated',
      })
    ).toBe('evaluation_disabled');
    expect(
      resolveGa4EvaluationDisplayStatus({
        killSwitchEnabled: true,
        needsReauth: true,
        persistedStatus: 'evaluating',
      })
    ).toBe('needs_reauth');
    expect(
      resolveGa4EvaluationDisplayStatus({
        killSwitchEnabled: true,
        needsReauth: false,
        persistedStatus: 'evaluating',
      })
    ).toBe('evaluating');
    expect(
      resolveGa4EvaluationDisplayStatus({
        killSwitchEnabled: true,
        needsReauth: false,
        persistedStatus: 'evaluated',
      })
    ).toBe('evaluated');
  });

  it('評価失敗時も直前の正常結果を保持する', () => {
    const projection = {
      status: 'evaluated' as const,
      lastSuccess: { historyId: 'history-id', evaluatedAt: '2026-08-08T00:00:00.000Z' },
      lastErrorCode: null,
    };

    expect(applyGa4EvaluationFailure(projection, 'llm_output_invalid')).toEqual({
      status: 'evaluation_failed',
      lastSuccess: projection.lastSuccess,
      lastErrorCode: 'llm_output_invalid',
    });
  });
});
