-- GA4コンテンツ評価: プロンプト監査用フィンガープリント機構を撤去する。
--
-- 背景: context_schema_version・input_fingerprint・scoring_config_version・
-- prompt_template_id・prompt_version_id・prompt_version・prompt_captured_at・
-- prompt_content_sha256 は、LLM呼び出しの再現性監査を目的に開発チームが
-- 独自に追加した機構だが、クライアント提供の要件文書（client-vision-from-lark.md・
-- ga4-evaluation-engine-spec-20260817.md）のいずれにも根拠が無く、他のAI機能
-- （gscSuggestionService等）にも同型の前例が無い。実装調査の結果、
-- prompt_content_sha256・input_fingerprint・prompt_template_id・
-- prompt_version_id・prompt_captured_atは保存されるだけで一度も読み出されず、
-- prompt_version・scoring_config_versionも記事詳細の「評価情報」アコーディオンに
-- 内部バージョン番号を表示するためだけに使われ、しかもR-14が掲げた本来の目的
-- （バージョンをまたいだスコア比較の防止）は前回値取得ロジック
-- （findPreviousSuccessfulScores）が対応しておらず機能していなかった。
-- ユーザー指示（2026-08-25「一式削除しよう」）により機構全体を削除する。

alter table public.ga4_content_evaluation_history
  drop column if exists context_schema_version,
  drop column if exists input_fingerprint,
  drop column if exists scoring_config_version,
  drop column if exists prompt_template_id,
  drop column if exists prompt_version_id,
  drop column if exists prompt_version,
  drop column if exists prompt_captured_at,
  drop column if exists prompt_content_sha256;
-- Rollback: 20260818000100_create_ga4_content_evaluation_tables.sql の該当列定義を
-- 再適用し、start_ga4_content_evaluation / finish_ga4_content_evaluation を
-- 20260825000000_split_evaluation_stale_error_code.sql /
-- 20260818000200_add_ga4_content_evaluation_rpcs.sql の定義へ戻す。

-- 関数本体は 20260825000000_split_evaluation_stale_error_code.sql の現行定義を
-- 踏襲し、insert 文から scoring_config_version 列を除いただけ。
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

  insert into public.ga4_content_evaluation_history (evaluation_run_id, user_id, content_annotation_id, status)
  values (run_id, p_user_id, p_content_annotation_id, 'evaluating');
  return query select run_id;
end;
$$;
-- Rollback: 20260825000000_split_evaluation_stale_error_code.sql の定義を再適用する。

-- finish_ga4_content_evaluation はパラメータを削るため create or replace ではなく
-- 明示的に drop してから作り直す（Postgres は末尾パラメータの削除を「置換」ではなく
-- 別オーバーロードの新設として扱うため）。
drop function if exists public.finish_ga4_content_evaluation(uuid, uuid, uuid, text, text, text, integer, numeric, numeric, numeric, integer, integer, integer, text, integer, integer, integer, integer, integer, integer, numeric, jsonb, jsonb, date, date, text, text, text, timestamptz, integer, text, uuid, uuid, integer, timestamptz, text);

create function public.finish_ga4_content_evaluation(
  p_user_id uuid,
  p_content_annotation_id uuid,
  p_evaluation_run_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null,
  p_attempt_count integer default 0,
  p_read_rate numeric default null,
  p_engage_rate numeric default null,
  p_scroll_rate numeric default null,
  p_read_score integer default null,
  p_engage_score integer default null,
  p_content_score integer default null,
  p_diagnosis_code text default null,
  p_site_rank integer default null,
  p_total_articles integer default null,
  p_sessions integer default null,
  p_char_count integer default null,
  p_image_count integer default null,
  p_expected_read_seconds integer default null,
  p_avg_engagement_seconds numeric default null,
  p_narrative_json jsonb default null,
  p_data_quality_json jsonb default null,
  p_period_start date default null,
  p_period_end date default null,
  p_canonical_url_snapshot text default null,
  p_title_snapshot text default null,
  p_ga4_property_id text default null,
  p_ga4_data_fetched_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('evaluated','narrative_failed','insufficient_data','import_failed','evaluation_failed') then
    raise exception 'invalid evaluation status';
  end if;
  if p_status = 'evaluated' and (
    p_read_score is null or p_engage_score is null or p_content_score is null
    or p_diagnosis_code is null or p_narrative_json is null
  ) then
    raise exception 'evaluated result is incomplete';
  end if;
  if p_status = 'narrative_failed' and (
    p_read_score is null or p_engage_score is null or p_content_score is null
    or p_diagnosis_code is null or p_narrative_json is not null
  ) then
    raise exception 'narrative_failed result is incomplete';
  end if;
  update public.ga4_content_evaluation_history
  set status = p_status, completed_at = timezone('utc', now()), attempt_count = p_attempt_count,
      error_code = p_error_code, error_message = p_error_message,
      read_rate = p_read_rate, engage_rate = p_engage_rate, scroll_rate = p_scroll_rate,
      read_score = p_read_score, engage_score = p_engage_score, content_score = p_content_score,
      diagnosis_code = p_diagnosis_code, site_rank = p_site_rank, total_articles = p_total_articles,
      sessions = p_sessions, char_count = p_char_count, image_count = p_image_count,
      expected_read_seconds = p_expected_read_seconds, avg_engagement_seconds = p_avg_engagement_seconds,
      narrative_json = p_narrative_json, data_quality_json = p_data_quality_json,
      period_start = p_period_start, period_end = p_period_end,
      canonical_url_snapshot = p_canonical_url_snapshot, title_snapshot = p_title_snapshot,
      ga4_property_id = p_ga4_property_id, ga4_data_fetched_at = p_ga4_data_fetched_at
  where evaluation_run_id = p_evaluation_run_id and user_id = p_user_id
    and content_annotation_id = p_content_annotation_id and status = 'evaluating';
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then return false; end if;

  if p_status in ('evaluated','narrative_failed') then
    update public.ga4_content_evaluations
      set status = p_status, active_run_id = null, evaluation_started_at = null, lease_expires_at = null,
          last_success_history_id = (select id from public.ga4_content_evaluation_history where evaluation_run_id = p_evaluation_run_id),
          last_success_evaluated_at = timezone('utc', now()), last_error_code = p_error_code, last_error_message = p_error_message
      where user_id = p_user_id and content_annotation_id = p_content_annotation_id
        and active_run_id = p_evaluation_run_id;
  else
    update public.ga4_content_evaluations
      set status = p_status, active_run_id = null, evaluation_started_at = null, lease_expires_at = null,
          last_error_code = p_error_code, last_error_message = p_error_message
      where user_id = p_user_id and content_annotation_id = p_content_annotation_id
        and active_run_id = p_evaluation_run_id;
  end if;
  return true;
end;
$$;
-- Rollback: この関数を drop し、20260818000200_add_ga4_content_evaluation_rpcs.sql の
-- 36引数版を再作成する。

revoke execute on function public.finish_ga4_content_evaluation(uuid, uuid, uuid, text, text, text, integer, numeric, numeric, numeric, integer, integer, integer, text, integer, integer, integer, integer, integer, integer, numeric, jsonb, jsonb, date, date, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_ga4_content_evaluation(uuid, uuid, uuid, text, text, text, integer, numeric, numeric, numeric, integer, integer, integer, text, integer, integer, integer, integer, integer, integer, numeric, jsonb, jsonb, date, date, text, text, text, timestamptz) to service_role;
