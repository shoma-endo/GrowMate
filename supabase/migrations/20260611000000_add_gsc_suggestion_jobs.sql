-- Track GSC suggestion generation separately from ranking evaluation so slow LLM
-- calls can be retried without rerunning the evaluation.
alter table public.gsc_article_evaluation_history
  add column if not exists suggestion_status text
    check (suggestion_status in ('pending', 'processing', 'completed', 'failed')),
  add column if not exists suggestion_stage smallint
    check (suggestion_stage between 1 and 4),
  add column if not exists suggestion_attempt_count integer not null default 0
    check (suggestion_attempt_count >= 0),
  add column if not exists suggestion_next_retry_at timestamptz,
  add column if not exists suggestion_error text,
  add column if not exists suggestion_started_at timestamptz,
  add column if not exists suggestion_completed_at timestamptz,
  add column if not exists suggestion_job_token uuid;

create index if not exists idx_gsc_evaluation_history_suggestion_jobs
  on public.gsc_article_evaluation_history (suggestion_status, suggestion_next_retry_at, created_at)
  where suggestion_status in ('pending', 'failed', 'processing');

create or replace function public.claim_gsc_suggestion_jobs(p_limit integer default 2)
returns table (
  id uuid,
  user_id uuid,
  content_annotation_id uuid,
  outcome text,
  current_position numeric,
  previous_position numeric,
  suggestion_stage smallint,
  suggestion_attempt_count integer,
  suggestion_job_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 2 then
    raise exception 'p_limit must be between 1 and 2';
  end if;

  update public.gsc_article_evaluation_history as history
  set
    suggestion_status = 'failed',
    suggestion_error = coalesce(history.suggestion_error, 'GSC改善提案の生成がタイムアウトしました'),
    suggestion_next_retry_at = null
  where history.suggestion_status = 'processing'
    and history.suggestion_attempt_count >= 3
    and history.suggestion_started_at <= timezone('utc', now()) - interval '15 minutes';

  return query
  with candidate as (
    select history.id
    from public.gsc_article_evaluation_history as history
    where (
      history.suggestion_status = 'pending'
      or (
        history.suggestion_status = 'failed'
        and history.suggestion_attempt_count < 3
        and coalesce(history.suggestion_next_retry_at, timezone('utc', now()))
          <= timezone('utc', now())
      )
      or (
        history.suggestion_status = 'processing'
        and history.suggestion_attempt_count < 3
        and history.suggestion_started_at
          <= timezone('utc', now()) - interval '15 minutes'
      )
    )
    and history.suggestion_stage is not null
    order by history.created_at
    for update skip locked
    limit p_limit
  )
  update public.gsc_article_evaluation_history as history
  set
    suggestion_status = 'processing',
    suggestion_attempt_count = history.suggestion_attempt_count + 1,
    suggestion_started_at = timezone('utc', now()),
    suggestion_error = null,
    suggestion_job_token = gen_random_uuid()
  from candidate
  where history.id = candidate.id
  returning
    history.id,
    history.user_id,
    history.content_annotation_id,
    history.outcome,
    history.current_position,
    history.previous_position,
    history.suggestion_stage,
    history.suggestion_attempt_count,
    history.suggestion_job_token;
end;
$$;

revoke all on function public.claim_gsc_suggestion_jobs(integer) from public;
grant execute on function public.claim_gsc_suggestion_jobs(integer) to service_role;

-- Rollback:
-- drop function if exists public.claim_gsc_suggestion_jobs(integer);
-- drop index if exists public.idx_gsc_evaluation_history_suggestion_jobs;
-- alter table public.gsc_article_evaluation_history
--   drop column if exists suggestion_job_token,
--   drop column if exists suggestion_completed_at,
--   drop column if exists suggestion_started_at,
--   drop column if exists suggestion_error,
--   drop column if exists suggestion_next_retry_at,
--   drop column if exists suggestion_attempt_count,
--   drop column if exists suggestion_stage,
--   drop column if exists suggestion_status;
