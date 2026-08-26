-- Remove GA4 content evaluation Kill Switch.
-- Evaluation is gated by role (admin/paid) only; no DB enabled flag.

create or replace function public.start_ga4_content_evaluation(
  p_user_id uuid,
  p_content_annotation_id uuid
)
returns table(evaluation_run_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  evaluation_row public.ga4_content_evaluations%rowtype;
  run_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if not exists (
    select 1 from public.content_annotations
    where id = p_content_annotation_id and user_id = p_user_id::text
  ) then
    raise exception 'content annotation owner mismatch';
  end if;

  select * into evaluation_row
  from public.ga4_content_evaluations
  where user_id = p_user_id and content_annotation_id = p_content_annotation_id
  for update;

  if evaluation_row.id is null then
    insert into public.ga4_content_evaluations (user_id, content_annotation_id, status, active_run_id, evaluation_started_at, lease_expires_at)
    values (p_user_id, p_content_annotation_id, 'evaluating', run_id, timezone('utc', now()), timezone('utc', now()) + interval '15 minutes')
    on conflict (user_id, content_annotation_id) do nothing;
    select * into evaluation_row
    from public.ga4_content_evaluations
    where user_id = p_user_id and content_annotation_id = p_content_annotation_id
    for update;
  end if;

  if evaluation_row.id is not null and evaluation_row.status = 'evaluating'
    and (evaluation_row.active_run_id is null or evaluation_row.active_run_id <> run_id) then
    if evaluation_row.evaluation_started_at is not null
      and evaluation_row.evaluation_started_at > timezone('utc', now()) - interval '15 minutes' then
      raise exception 'ga4 evaluation already running';
    end if;
    update public.ga4_content_evaluation_history
      set status = 'evaluation_failed', completed_at = timezone('utc', now()),
          error_code = 'evaluation_stale', error_message = '評価実行が期限切れになりました'
      where evaluation_run_id = evaluation_row.active_run_id and status = 'evaluating';
  end if;

  if evaluation_row.id is not null then
    update public.ga4_content_evaluations
      set status = 'evaluating', active_run_id = run_id,
          evaluation_started_at = timezone('utc', now()), lease_expires_at = timezone('utc', now()) + interval '15 minutes',
          last_error_code = null, last_error_message = null
      where id = evaluation_row.id;
  end if;

  insert into public.ga4_content_evaluation_history (evaluation_run_id, user_id, content_annotation_id, status, scoring_config_version)
  values (run_id, p_user_id, p_content_annotation_id, 'evaluating', 1);
  return query select run_id;
end;
$$;

drop policy if exists ga4_content_evaluation_settings_admin on public.ga4_content_evaluation_settings;
drop table if exists public.ga4_content_evaluation_settings;

-- Rollback:
-- recreate public.ga4_content_evaluation_settings from 20260818000100_create_ga4_content_evaluation_tables.sql
-- and restore the Kill Switch check in start_ga4_content_evaluation from 20260818000200_add_ga4_content_evaluation_rpcs.sql
