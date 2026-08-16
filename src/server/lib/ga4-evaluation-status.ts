import type {
  Ga4EvaluationDisplayStatus,
  Ga4EvaluationErrorCode,
  Ga4EvaluationProjection,
  Ga4PersistentEvaluationStatus,
} from '@/types/ga4-evaluation';

export interface Ga4EvaluationDisplayInput {
  killSwitchEnabled: boolean;
  needsReauth: boolean;
  persistedStatus: Ga4PersistentEvaluationStatus | null;
}

export function resolveGa4EvaluationDisplayStatus(
  input: Ga4EvaluationDisplayInput
): Ga4EvaluationDisplayStatus {
  if (!input.killSwitchEnabled) {
    return 'evaluation_disabled';
  }
  if (input.needsReauth) {
    return 'needs_reauth';
  }
  if (input.persistedStatus) {
    return input.persistedStatus;
  }
  return 'unassessed';
}

export function applyGa4EvaluationFailure(
  projection: Ga4EvaluationProjection,
  errorCode: Ga4EvaluationErrorCode
): Ga4EvaluationProjection {
  return {
    status: 'evaluation_failed',
    lastSuccess: projection.lastSuccess,
    lastErrorCode: errorCode,
  };
}
