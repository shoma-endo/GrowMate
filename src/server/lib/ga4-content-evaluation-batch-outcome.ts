import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

/**
 * 定期評価バッチの結末の判定契約（docs/plans/ga4-content-evaluation-spec.md §8.3）。
 * displayStatus では判定しない。history[0] が「今回の run() 呼び出しが作った履歴行」で
 * あることを startedAt で確認し、その行の status（永続6値）を結末とする。
 */
export type Ga4CycleBatchOutcome =
  | 'evaluated'
  | 'narrative_failed'
  | 'insufficient_data'
  | 'import_failed'
  | 'evaluation_failed'
  | 'evaluating'
  | 'low_data'
  | 'already_running'
  | 'unknown_error'
  // 定期評価バッチの初回パス（ベースラインのみ。LLM・通知なし）が成功した結末。
  // ga4_content_evaluation_history には対応する行が存在しない（永続statusではない）。
  // classifyGa4BatchRunResult では生成されず、ga4ContentEvaluationCycleService の
  // runBaselinePass が直接組み立てる（GSCの baseline_initialized と同型）。
  | 'baseline_initialized';

export interface Ga4CycleBatchOutcomeResult {
  outcome: Ga4CycleBatchOutcome;
  historyId: string | null;
  /** §6.6.4 クールダウンの表に従い、last_evaluated_on を進めるべきか */
  shouldAdvanceCooldown: boolean;
  /** true の場合は呼び出し側で console.error による構造化ログを出す（想定外の状態） */
  isUnexpected: boolean;
}

/**
 * run() が正常に戻った場合の結末判定（§8.3 手順2）。
 * @param callStartedAtMs run() を呼び出した直前の Date.now()
 */
export function classifyGa4BatchRunResult(
  view: Ga4ContentEvaluationView,
  callStartedAtMs: number
): Ga4CycleBatchOutcomeResult {
  const latest = view.history[0];
  const hasFreshHistory = latest !== undefined && Date.parse(latest.startedAt) >= callStartedAtMs;

  if (!hasFreshHistory) {
    // history が空、または前回までの履歴行しかない = 今回の実行は履歴行を作っていない。
    if (view.displayStatus === 'unassessed' || view.displayStatus === 'eligible') {
      // run() が履歴行を作らずに戻った異常系（想定外）。
      return { outcome: 'unknown_error', historyId: null, shouldAdvanceCooldown: false, isUnexpected: true };
    }
    // BR-08 の足切りによる早期 return。projection/history は前回の値なので参照しない。
    return { outcome: 'low_data', historyId: null, shouldAdvanceCooldown: true, isUnexpected: false };
  }

  if (latest.status === 'evaluating') {
    // run() が終端に達さずに戻った異常系。
    return { outcome: 'evaluating', historyId: latest.id, shouldAdvanceCooldown: false, isUnexpected: true };
  }

  return { outcome: latest.status, historyId: latest.id, shouldAdvanceCooldown: true, isUnexpected: false };
}

/** run() が例外を投げた場合の結末判定（§8.3 手順1）。 */
export function classifyGa4BatchRunError(error: unknown): Ga4CycleBatchOutcomeResult {
  if (error instanceof Error && error.message.includes('already running')) {
    return { outcome: 'already_running', historyId: null, shouldAdvanceCooldown: false, isUnexpected: false };
  }
  return { outcome: 'unknown_error', historyId: null, shouldAdvanceCooldown: true, isUnexpected: true };
}
