-- Create Instagram credentials table (Phase 1)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS update_instagram_credentials_updated_at ON instagram_credentials;
--   DROP POLICY IF EXISTS "instagram_credentials_select_own" ON instagram_credentials;
--   DROP TABLE IF EXISTS instagram_credentials;

create table public.instagram_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  ig_user_id text not null,
  username text,
  account_type text,
  profile_picture_url text,
  access_token text not null,
  access_token_expires_at timestamptz not null,
  access_token_issued_at timestamptz not null default now(),
  scope text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instagram_credentials enable row level security;

create policy "instagram_credentials_select_own"
  on public.instagram_credentials for select
  using (user_id::text = any(public.get_accessible_user_ids((select auth.uid()))));

drop trigger if exists update_instagram_credentials_updated_at on public.instagram_credentials;
create trigger update_instagram_credentials_updated_at
  before update on public.instagram_credentials
  for each row execute function update_updated_at_column();
