import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

type Ga4EvaluationHistoryItem = Ga4ContentEvaluationView['history'][number];

/**
 * 記事カードが本文として表示している履歴1件を返す。
 *
 * カードと履歴パネルの両方がこの関数を使う。履歴パネルはここで返った1件を除いて
 * 描くため、判定がずれると「カードに出ている評価が履歴にも出る」か
 * 「どこにも出ない」のどちらかが起きる。必ず共有すること。
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
