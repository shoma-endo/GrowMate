-- 一覧のスコア閾値フィルタ(D11。docs/plans/ga4-content-evaluation-spec.md §10.2 / §6.4)
-- p_ga4_content_score_below を追加する。既定は null（フィルタなし＝従来どおり）。
-- スコアを持たない記事（unassessed / R_LOWDATA 等で ga4_content_score が null）は対象外とする。

drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean);

create or replace function public.get_filtered_content_annotations(
  p_user_id uuid,
  p_page integer,
  p_per_page integer,
  p_selected_category_names text[] default '{}'::text[],
  p_include_uncategorized boolean default false,
  p_has_unread_suggestion boolean default false,
  p_has_unstarted_gsc_evaluation boolean default false,
  p_has_unstarted_ga4_evaluation boolean default false,
  p_ga4_content_score_below integer default null
)
returns table(items jsonb, total_count bigint)
language sql stable
as $$
  with normalized as (
    select
      greatest(1, coalesce(p_page, 1)) as page,
      greatest(1, least(100, coalesce(p_per_page, 100))) as per_page,
      coalesce((select array_agg(trimmed_name) from (
        select distinct trim(name) as trimmed_name
        from unnest(coalesce(p_selected_category_names, '{}'::text[])) as name
        where trim(name) <> ''
      ) names), '{}'::text[]) as selected_names,
      coalesce(p_include_uncategorized, false) as include_uncategorized,
      coalesce(p_has_unread_suggestion, false) as has_unread_suggestion,
      coalesce(p_has_unstarted_gsc_evaluation, false) as has_unstarted_gsc_evaluation,
      coalesce(p_has_unstarted_ga4_evaluation, false) as has_unstarted_ga4_evaluation,
      p_ga4_content_score_below as ga4_content_score_below
  ), filtered as (
    select ca.*
    from public.content_annotations ca
    cross join normalized n
    cross join lateral (
      select coalesce(array_agg(trim(category_name)) filter (where trim(category_name) <> ''), '{}'::text[]) as names
      from unnest(coalesce(ca.wp_category_names, '{}'::text[])) as category_name
    ) categories
    where ca.user_id = p_user_id::text
      and (
        (coalesce(array_length(n.selected_names, 1), 0) = 0 and not n.include_uncategorized)
        or (coalesce(array_length(n.selected_names, 1), 0) > 0 and categories.names && n.selected_names)
        or (n.include_uncategorized and coalesce(array_length(categories.names, 1), 0) = 0)
      )
      and (
        not n.has_unread_suggestion
        or exists (
          select 1 from public.gsc_article_evaluation_history h
          where h.content_annotation_id = ca.id and h.user_id = p_user_id
            and h.is_read = false and h.outcome_type <> 'error'
            and h.outcome is not null and h.outcome <> 'improved'
        )
      )
      and (
        not n.has_unstarted_gsc_evaluation
        or not exists (
          select 1 from public.gsc_article_evaluations e
          where e.content_annotation_id = ca.id
        )
      )
      and (
        not n.has_unstarted_ga4_evaluation
        or not exists (
          select 1 from public.ga4_content_evaluations e
          where e.content_annotation_id = ca.id and e.user_id = p_user_id
        )
      )
  ), scored as (
    select
      f.*,
      latest.status as ga4_evaluation_status,
      latest.content_score as ga4_content_score,
      latest.diagnosis_code as ga4_diagnosis_code,
      latest.evaluated_at as ga4_last_evaluated_at
    from filtered f
    cross join normalized n
    left join lateral (
      select ev.status, h.content_score, h.diagnosis_code, h.completed_at as evaluated_at
      from public.ga4_content_evaluations ev
      left join public.ga4_content_evaluation_history h on h.id = ev.last_success_history_id
      where ev.user_id = p_user_id and ev.content_annotation_id = f.id
    ) latest on true
    where n.ga4_content_score_below is null
      or (latest.content_score is not null and latest.content_score < n.ga4_content_score_below)
  ), ordered as (
    select
      s.*,
      row_number() over (order by s.updated_at desc nulls last) as rn
    from scored s
  ), paged as (
    select to_jsonb(o.*) as annotation, o.rn
    from ordered o cross join normalized n
    where o.rn > (n.page - 1) * n.per_page and o.rn <= n.page * n.per_page
  )
  select coalesce((select jsonb_agg(p.annotation order by p.rn) from paged p), '[]'::jsonb),
         coalesce((select count(*) from scored), 0)::bigint;
$$;

revoke execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, integer) from public, anon, authenticated;
grant execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, integer) to service_role;

-- Rollback: 20260818000300_update_get_filtered_content_annotations_for_ga4.sql の定義（p_ga4_content_score_below なし）を再適用する。
