/**
 * コンテンツ評価サイクルの due 判定（docs/plans/ga4-content-evaluation-spec.md §6.6.2）。
 * GSC の `gscEvaluationService.isDue`（gscEvaluationService.ts:568-587）と同値の判定式。
 *
 * next_evaluation_date <= today_jst の行は DB 側（RPC）で絞り込み済みのため、
 * ここでは「today ちょうどのときだけ evaluation_hour を見る」判定のみを行う。
 */
export function isGa4CycleDue(
  nextEvaluationDate: string,
  evaluationHour: number,
  todayJst: string,
  currentHourJst: number
): boolean {
  if (nextEvaluationDate < todayJst) return true;
  if (nextEvaluationDate > todayJst) return false;
  return currentHourJst >= evaluationHour;
}
