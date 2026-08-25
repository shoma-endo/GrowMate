import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

type Ga4EvaluationHistoryItem = Ga4ContentEvaluationView['history'][number];

/**
 * 記事カードが本文として表示している履歴1件を返す。
 *
 * 記事カード（`ContentEvaluationCard.tsx`）と、概要タブのサイクル設定カード
 * （`../../ContentEvaluationCycleSettings.tsx`）が「今どの評価を主役として出しているか」を
 * 判断するために使う。カードの前回差分（`findPreviousScoredItem`）の起点でもある。
 *
 * 評価履歴パネルはこの1件を含めて**全件**を描く（2026-08-25。検索順位評価履歴と同じ
 * 読み方に揃えた際、一覧が1行サマリーになり「同じ内容を2度読ませる」問題が解消したため。
 * それ以前はここで返った1件を履歴から除外していた）。
 */
export function resolveCardHistoryItem(
  evaluation: Ga4ContentEvaluationView | null
): Ga4EvaluationHistoryItem | null {
  if (!evaluation) return null;
  return (
    evaluation.history.find(item => item.id === evaluation.projection?.lastSuccessHistoryId) ??
    evaluation.history.find(
      item => item.status === 'evaluated' || item.status === 'narrative_failed'
    ) ??
    null
  );
}
