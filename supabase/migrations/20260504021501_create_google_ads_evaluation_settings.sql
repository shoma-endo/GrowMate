-- Create Google Ads AI evaluation settings for the MVP manual execution flow.
--
-- Rollback:
--   drop policy if exists "google_ads_eval_settings_select" on public.google_ads_evaluation_settings;
--   drop table if exists public.google_ads_evaluation_settings cascade;

create table if not exists public.google_ads_evaluation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date_range_days integer not null default 30,
  last_evaluated_on date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(user_id)
);

alter table public.google_ads_evaluation_settings enable row level security;

drop policy if exists "google_ads_eval_settings_select" on public.google_ads_evaluation_settings;
create policy "google_ads_eval_settings_select"
  on public.google_ads_evaluation_settings for select
  using (user_id::text = any(get_accessible_user_ids(auth.uid())));
