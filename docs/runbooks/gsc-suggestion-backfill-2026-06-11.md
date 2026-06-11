# GSC改善提案欠落分の手動バックフィル

2026-06-11 22:27 JST 前後の `gsc-evaluate` タイムアウトで欠落した改善提案は、
対象行と元の提案ステージを確認してから手動で再投入する。

## 対象確認

```sql
select
  history.id,
  history.user_id,
  history.content_annotation_id,
  history.created_at,
  history.outcome,
  evaluation.current_suggestion_stage
from public.gsc_article_evaluation_history as history
join public.gsc_article_evaluations as evaluation
  on evaluation.user_id = history.user_id
  and evaluation.content_annotation_id = history.content_annotation_id
where history.created_at between '2026-06-11T13:20:00Z' and '2026-06-11T13:35:00Z'
  and history.outcome_type = 'success'
  and history.outcome in ('no_change', 'worse')
  and history.suggestion_summary is null
  and history.suggestion_status is null;
```

`current_suggestion_stage` は評価後に進んだ値のため、そのまま元ステージとして使用できない。

- 現在値が2または3の場合、元ステージ候補は現在値から1を引いた値
- 現在値が4の場合、元ステージは3または4のためDBだけでは判別不能

対象記事の過去履歴と生成対象を確認し、再投入するステージを明示的に決定する。

## 再投入

```sql
update public.gsc_article_evaluation_history
set
  suggestion_status = 'pending',
  suggestion_stage = values_to_backfill.suggestion_stage,
  suggestion_next_retry_at = timezone('utc', now()),
  suggestion_error = null
from (
  values
    -- 対象確認後、履歴IDと元ステージを明示する
    ('00000000-0000-0000-0000-000000000000'::uuid, 1::smallint)
) as values_to_backfill(history_id, suggestion_stage)
where gsc_article_evaluation_history.id = values_to_backfill.history_id
  and gsc_article_evaluation_history.suggestion_summary is null
  and gsc_article_evaluation_history.suggestion_status is null;
```
