-- Rollback:
--   select cron.unschedule('cleanup-cron-run-logs-ttl');
--   drop table if exists public.cron_run_logs;

create table if not exists public.cron_run_logs (
  id uuid primary key default gen_random_uuid(),
  cron_name text not null,
  event text not null,
  level text not null check (level in ('info', 'warn', 'error')),
  environment text not null check (environment in ('production', 'preview', 'local')),
  details jsonb not null default '{}'::jsonb,
  logged_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_cron_run_logs_cron_name_logged_at
  on public.cron_run_logs (cron_name, logged_at desc);

alter table public.cron_run_logs enable row level security;

revoke all on table public.cron_run_logs from anon, authenticated;

create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-cron-run-logs-ttl',
  '0 0 * * *',
  $$
    delete from public.cron_run_logs
    where created_at < now() - interval '90 days';
  $$
);
