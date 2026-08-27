-- evaluation_stale の error_code を分離する。
--
-- 背景: `evaluation_stale` は2つの異なる原因を1つのコードで表現しており、
-- UI表示（GA4_ERROR_LABELS.evaluation_stale＝「評価結果が古いため、再評価が必要です」）が
-- 原因と食い違っていた。
--   1. GA4取込データの鮮度不足（アプリ側 `ga4ContentEvaluationService.ts` の run() が
--      insufficient_data として打ち切るケース。評価結果自体が存在しない）→ 本migrationでは
--      アプリ側の文字列リテラルを 'ga4_data_stale' に変更するのみ（DB変更不要）。
--   2. 前回runの15分リース期限切れによる強制確定（本RPC。status='evaluation_failed'）→
--      本migrationで error_code を 'evaluation_run_expired' に変更する。
--      error_message（「評価実行が期限切れになりました」）は元々正確なため変更しない。
--
-- 関数本体は 20260819000200_drop_ga4_content_evaluation_settings.sql の現行定義をそのまま
-- 踏襲し、error_code の1行のみ変更する。

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
          error_code = 'evaluation_run_expired', error_message = '評価実行が期限切れになりました'
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

-- Rollback:
-- create or replace function public.start_ga4_content_evaluation(...) を
-- 20260819000200_drop_ga4_content_evaluation_settings.sql の定義（error_code = 'evaluation_stale'）
-- で再適用する。
