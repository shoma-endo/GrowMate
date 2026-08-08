-- Phase 2: instagram_media + instagram_account_insights_daily (reach / follower_count only)

create table public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ig_media_id text not null,
  media_type text not null check (media_type in ('IMAGE','VIDEO','CAROUSEL_ALBUM')),
  media_product_type text not null check (media_product_type in ('FEED','REELS')),
  caption text,
  media_url text,
  thumbnail_url text,
  permalink text not null,
  posted_at timestamptz not null,
  like_count int,
  comments_count int,
  reach int,
  views int,
  saved int,
  shares int,
  total_interactions int,
  reposts int,
  reels_skip_rate numeric,
  avg_watch_time_ms int,
  total_watch_time_ms bigint,
  insights_synced_at timestamptz,
  insights_unavailable boolean not null default false,
  insights_unavailable_reason text check (
    insights_unavailable_reason is null
    or insights_unavailable_reason in ('pre_conversion', 'retention_expired')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ig_media_id)
);
-- Rollback: drop table if exists public.instagram_media;

create index if not exists idx_instagram_media_user_posted_at
  on public.instagram_media (user_id, posted_at desc);
-- Rollback: drop index if exists idx_instagram_media_user_posted_at;

alter table public.instagram_media enable row level security;

create policy "instagram_media_select_own"
  on public.instagram_media
  for select
  using (user_id = (select auth.uid()));
-- Rollback: drop policy if exists "instagram_media_select_own" on public.instagram_media;

drop trigger if exists update_instagram_media_updated_at on public.instagram_media;
create trigger update_instagram_media_updated_at
  before update on public.instagram_media
  for each row execute function update_updated_at_column();
-- Rollback: drop trigger if exists update_instagram_media_updated_at on public.instagram_media;

create table public.instagram_account_insights_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  reach int,
  follower_count int,
  imported_at timestamptz not null default now(),
  unique (user_id, date)
);
-- Rollback: drop table if exists public.instagram_account_insights_daily;

alter table public.instagram_account_insights_daily enable row level security;

create policy "instagram_account_insights_daily_select_own"
  on public.instagram_account_insights_daily
  for select
  using (user_id = (select auth.uid()));
-- Rollback: drop policy if exists "instagram_account_insights_daily_select_own" on public.instagram_account_insights_daily;

-- Service Role専用のため、明示的な書き込みポリシーは作成しない
