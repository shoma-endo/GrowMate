create table if not exists public.ga4_content_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content_annotation_id uuid not null references public.content_annotations(id) on delete cascade,
  status text not null check (status in ('evaluated','narrative_failed','insufficient_data','import_failed','evaluation_failed','evaluating')),
  active_run_id uuid,
  last_success_history_id uuid,
  last_success_evaluated_at timestamptz,
  evaluation_started_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, content_annotation_id)
);
-- Rollback: drop table if exists public.ga4_content_evaluations;

create table if not exists public.ga4_content_evaluation_history (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  content_annotation_id uuid not null references public.content_annotations(id) on delete cascade,
  status text not null check (status in ('evaluating','evaluated','narrative_failed','insufficient_data','import_failed','evaluation_failed')),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  read_rate numeric,
  engage_rate numeric,
  scroll_rate numeric,
  read_score integer check (read_score between 0 and 100),
  engage_score integer check (engage_score between 0 and 100),
  content_score integer check (content_score between 0 and 100),
  diagnosis_code text check (diagnosis_code in ('R_TOP_EXIT','R_MISMATCH','R_MID_EXIT','R_SKIM','R_GOOD')),
  site_rank integer check (site_rank > 0),
  total_articles integer check (total_articles >= 0),
  sessions integer check (sessions >= 0),
  char_count integer check (char_count >= 0),
  image_count integer check (image_count >= 0),
  expected_read_seconds integer check (expected_read_seconds >= 0),
  avg_engagement_seconds numeric,
  narrative_json jsonb,
  data_quality_json jsonb,
  period_start date,
  period_end date,
  canonical_url_snapshot text,
  title_snapshot text,
  ga4_property_id text,
  ga4_data_fetched_at timestamptz,
  context_schema_version integer not null default 1,
  input_fingerprint text,
  scoring_config_version integer not null,
  prompt_template_id uuid references public.prompt_templates(id) on delete set null,
  prompt_version_id uuid references public.prompt_versions(id) on delete set null,
  prompt_version integer,
  prompt_captured_at timestamptz,
  prompt_content_sha256 text,
  error_code text,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, content_annotation_id, evaluation_run_id),
  check (period_start is null or period_end is null or period_start <= period_end),
  check (status = 'evaluating' or completed_at is not null),
  check (
    status <> 'evaluated'
    or (
      read_score is not null and engage_score is not null and content_score is not null
      and diagnosis_code is not null and narrative_json is not null
    )
  ),
  check (
    status <> 'narrative_failed'
    or (
      read_score is not null and engage_score is not null and content_score is not null
      and diagnosis_code is not null and narrative_json is null
    )
  )
);
-- Rollback: drop table if exists public.ga4_content_evaluation_history;

create table if not exists public.ga4_content_evaluation_settings (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references public.users(id) on delete set null
);
-- Rollback: drop table if exists public.ga4_content_evaluation_settings;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ga4_content_evaluations_active_run_id_fkey'
  ) then
    alter table public.ga4_content_evaluations
      add constraint ga4_content_evaluations_active_run_id_fkey
      foreign key (active_run_id) references public.ga4_content_evaluation_history(evaluation_run_id)
      deferrable initially deferred;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ga4_content_evaluations_last_success_history_id_fkey'
  ) then
    alter table public.ga4_content_evaluations
      add constraint ga4_content_evaluations_last_success_history_id_fkey
      foreign key (last_success_history_id) references public.ga4_content_evaluation_history(id) on delete set null;
  end if;
end;
$$;
-- Rollback: alter table public.ga4_content_evaluations drop constraint if exists ga4_content_evaluations_active_run_id_fkey;
-- Rollback: alter table public.ga4_content_evaluations drop constraint if exists ga4_content_evaluations_last_success_history_id_fkey;

insert into public.ga4_content_evaluation_settings (id, enabled)
values (1, false)
on conflict (id) do nothing;

create index if not exists idx_ga4_content_evaluations_user_status_updated
  on public.ga4_content_evaluations(user_id, status, updated_at desc);
create index if not exists idx_ga4_content_evaluations_evaluating
  on public.ga4_content_evaluations(user_id, content_annotation_id)
  where status = 'evaluating';
create index if not exists idx_ga4_content_evaluations_annotation
  on public.ga4_content_evaluations(content_annotation_id);
create index if not exists idx_ga4_content_evaluation_history_user_annotation_created
  on public.ga4_content_evaluation_history(user_id, content_annotation_id, created_at desc);
create index if not exists idx_ga4_content_evaluation_history_run
  on public.ga4_content_evaluation_history(evaluation_run_id);
-- Rollback: drop index if exists idx_ga4_content_evaluations_user_status_updated;
-- Rollback: drop index if exists idx_ga4_content_evaluations_evaluating;
-- Rollback: drop index if exists idx_ga4_content_evaluations_annotation;
-- Rollback: drop index if exists idx_ga4_content_evaluation_history_user_annotation_created;
-- Rollback: drop index if exists idx_ga4_content_evaluation_history_run;

create or replace function public.update_ga4_content_evaluation_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
drop trigger if exists trg_ga4_content_evaluations_updated_at on public.ga4_content_evaluations;
create trigger trg_ga4_content_evaluations_updated_at before update on public.ga4_content_evaluations
for each row execute function public.update_ga4_content_evaluation_updated_at();
drop trigger if exists trg_ga4_content_evaluation_history_updated_at on public.ga4_content_evaluation_history;
create trigger trg_ga4_content_evaluation_history_updated_at before update on public.ga4_content_evaluation_history
for each row execute function public.update_ga4_content_evaluation_updated_at();
-- Rollback: drop trigger if exists trg_ga4_content_evaluations_updated_at on public.ga4_content_evaluations;
-- Rollback: drop trigger if exists trg_ga4_content_evaluation_history_updated_at on public.ga4_content_evaluation_history;
-- Rollback: drop function if exists public.update_ga4_content_evaluation_updated_at;

create or replace function public.validate_ga4_content_evaluation_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.content_annotations ca
    where ca.id = new.content_annotation_id and ca.user_id = new.user_id::text
  ) then
    raise exception 'GA4 evaluation owner mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ga4_content_evaluations_owner on public.ga4_content_evaluations;
create trigger trg_ga4_content_evaluations_owner before insert or update on public.ga4_content_evaluations
for each row execute function public.validate_ga4_content_evaluation_owner();
drop trigger if exists trg_ga4_content_evaluation_history_owner on public.ga4_content_evaluation_history;
create trigger trg_ga4_content_evaluation_history_owner before insert or update on public.ga4_content_evaluation_history
for each row execute function public.validate_ga4_content_evaluation_owner();
-- Rollback: drop trigger if exists trg_ga4_content_evaluations_owner on public.ga4_content_evaluations;
-- Rollback: drop trigger if exists trg_ga4_content_evaluation_history_owner on public.ga4_content_evaluation_history;
-- Rollback: drop function if exists public.validate_ga4_content_evaluation_owner;

alter table public.ga4_content_evaluations enable row level security;
alter table public.ga4_content_evaluation_history enable row level security;
alter table public.ga4_content_evaluation_settings enable row level security;
drop policy if exists ga4_content_evaluations_own on public.ga4_content_evaluations;
drop policy if exists ga4_content_evaluation_history_own on public.ga4_content_evaluation_history;
drop policy if exists ga4_content_evaluation_settings_admin on public.ga4_content_evaluation_settings;
create policy ga4_content_evaluations_own on public.ga4_content_evaluations
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ga4_content_evaluation_history_own on public.ga4_content_evaluation_history
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ga4_content_evaluation_settings_admin on public.ga4_content_evaluation_settings
  for select using ((select auth.role()) = 'service_role');
-- Rollback: drop policy if exists ga4_content_evaluations_own on public.ga4_content_evaluations;
-- Rollback: drop policy if exists ga4_content_evaluation_history_own on public.ga4_content_evaluation_history;
-- Rollback: drop policy if exists ga4_content_evaluation_settings_admin on public.ga4_content_evaluation_settings;
revoke all on table public.ga4_content_evaluations, public.ga4_content_evaluation_history, public.ga4_content_evaluation_settings from public, anon, authenticated;
grant all on table public.ga4_content_evaluations, public.ga4_content_evaluation_history, public.ga4_content_evaluation_settings to service_role;
revoke insert, update, delete on table public.ga4_content_evaluation_history from service_role;
grant select on table public.ga4_content_evaluation_history to service_role;
-- Rollback: restore the previous grants for the affected roles before dropping this migration.
