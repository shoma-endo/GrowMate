import type {
  Ga4EvaluationDisplayStatus,
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
