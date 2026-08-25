import type {
  Ga4EvaluationDisplayStatus,
  Ga4EvaluationErrorCode,
  Ga4EvaluationProjection,
  Ga4PersistentEvaluationStatus,
} from '@/types/ga4-evaluation';

export interface Ga4EvaluationDisplayInput {
  persistedStatus: Ga4PersistentEvaluationStatus | null;
  derivedStatus?: 'low_data' | 'eligible' | 'unassessed';
}

export function resolveGa4EvaluationDisplayStatus(
  input: Ga4EvaluationDisplayInput
): Ga4EvaluationDisplayStatus {
  if (input.persistedStatus) {
    return input.persistedStatus;
  }
  if (input.derivedStatus) return input.derivedStatus;
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
