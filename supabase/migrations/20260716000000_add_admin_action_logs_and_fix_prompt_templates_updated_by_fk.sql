-- Admin action audit logs and prompt_templates.updated_by FK fix for user deletion.
--
-- Rollback:
--   alter table public.prompt_templates drop constraint if exists prompt_templates_updated_by_fkey;
--   alter table public.prompt_templates
--     add constraint prompt_templates_updated_by_fkey
--       foreign key (updated_by)
--       references public.users(id)
--       on delete no action;
--   drop table if exists public.admin_action_logs;

create table if not exists public.admin_action_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action text not null,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  failure_code text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

alter table public.admin_action_logs enable row level security;

-- No policies: anon/authenticated are denied; service_role bypasses RLS (§8.1).
revoke all on table public.admin_action_logs from anon, authenticated;

alter table public.prompt_templates
  drop constraint if exists prompt_templates_updated_by_fkey;

alter table public.prompt_templates
  add constraint prompt_templates_updated_by_fkey
    foreign key (updated_by)
    references public.users(id)
    on delete set null;
