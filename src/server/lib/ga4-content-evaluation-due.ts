/**
 * GA4コンテンツ評価の due 判定（docs/plans/ga4-content-evaluation-spec.md §6.6.2）。
 * GSC の `gscEvaluationService.isDue`（gscEvaluationService.ts:568-587）と同値の判定式。
 *
 * スケジュール設定（基準日・サイクル日数・評価実行時間）は GSC の評価サイクル行と共有するが、
 * 進捗マークは系統別に持つ（`ga4_last_evaluated_on`）。due 日は RPC
 * `list_due_ga4_content_evaluations` が
 * `coalesce(ga4_last_evaluated_on, base_evaluation_date) + cycle_days` として算出し、
 * `<= today_jst` の行だけを返す。ここでは「today ちょうどのときだけ evaluation_hour を見る」
 * 判定のみを行う。
 */
export function isGa4ContentEvaluationDue(
  nextEvaluationDate: string,
  evaluationHour: number,
  todayJst: string,
  currentHourJst: number
): boolean {
  if (nextEvaluationDate < todayJst) return true;
  if (nextEvaluationDate > todayJst) return false;
  return currentHourJst >= evaluationHour;
}
