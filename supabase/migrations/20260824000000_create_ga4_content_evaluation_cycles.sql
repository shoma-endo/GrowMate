-- コンテンツ評価サイクル設定テーブル（フェーズ3。docs/plans/ga4-content-evaluation-spec.md §7.7）
-- GSC の gsc_article_evaluations と同型。既存 ga4_content_evaluations へ列追加しない理由は
-- §7.7「なぜ既存テーブルに列を足さないか」（status CHECK が settings 専用行を許さない・
-- 行の作成主体が start_ga4_content_evaluation RPC に限られるため）。

create table if not exists public.ga4_content_evaluation_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  content_annotation_id uuid not null references public.content_annotations(id) on delete cascade,
  base_evaluation_date date not null,
  cycle_days integer not null default 30 check (cycle_days between 1 and 365),
  evaluation_hour smallint not null default 12 check (evaluation_hour between 0 and 23),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  last_evaluated_on date,
  -- ベースライン（初回計測）のコンテンツ力スコア。GSCの last_seen_position と同じ役割（D10確定）。
  -- ga4_content_evaluation_history には残さない（§6.6.2）。
  last_seen_content_score integer check (last_seen_content_score between 0 and 100),
  last_notified_history_id uuid references public.ga4_content_evaluation_history(id) on delete set null,
  last_notification_status text check (last_notification_status in ('sent', 'skipped_no_email', 'failed')),
  last_notification_error text,
  last_notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, content_annotation_id)
);

-- due 抽出を DB 側で行うため（§6.6.2）。GSC の 20260618000000 migration と同じ最適化。
alter table public.ga4_content_evaluation_cycles
  add column if not exists next_evaluation_date date generated always as (
    coalesce(last_evaluated_on, base_evaluation_date)::date + coalesce(cycle_days, 30)
  ) stored;

create index if not exists idx_ga4_content_evaluation_cycles_due
  on public.ga4_content_evaluation_cycles (status, next_evaluation_date)
  where status = 'active';

create index if not exists idx_ga4_content_evaluation_cycles_annotation
  on public.ga4_content_evaluation_cycles (content_annotation_id);

-- updated_at trigger は 20260818000100 で作成済みの関数を再利用する
drop trigger if exists trg_ga4_content_evaluation_cycles_updated_at on public.ga4_content_evaluation_cycles;
create trigger trg_ga4_content_evaluation_cycles_updated_at before update on public.ga4_content_evaluation_cycles
for each row execute function public.update_ga4_content_evaluation_updated_at();

-- 所有者検証 trigger も 20260818000100 で作成済みの汎用関数を再利用する
drop trigger if exists trg_ga4_content_evaluation_cycles_owner on public.ga4_content_evaluation_cycles;
create trigger trg_ga4_content_evaluation_cycles_owner before insert or update on public.ga4_content_evaluation_cycles
for each row execute function public.validate_ga4_content_evaluation_owner();

alter table public.ga4_content_evaluation_cycles enable row level security;
drop policy if exists ga4_content_evaluation_cycles_own on public.ga4_content_evaluation_cycles;
create policy ga4_content_evaluation_cycles_own on public.ga4_content_evaluation_cycles
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Service Role には all を付与する（バッチが last_evaluated_on と通知記録を更新するため）。
-- 履歴テーブルのような書き込み剥奪（revoke insert, update, delete）は行わない（§7.7）。
revoke all on table public.ga4_content_evaluation_cycles from public, anon, authenticated;
grant all on table public.ga4_content_evaluation_cycles to service_role;

-- Rollback:
-- drop trigger if exists trg_ga4_content_evaluation_cycles_owner on public.ga4_content_evaluation_cycles;
-- drop trigger if exists trg_ga4_content_evaluation_cycles_updated_at on public.ga4_content_evaluation_cycles;
-- drop policy if exists ga4_content_evaluation_cycles_own on public.ga4_content_evaluation_cycles;
-- drop index if exists idx_ga4_content_evaluation_cycles_due;
-- drop index if exists idx_ga4_content_evaluation_cycles_annotation;
-- drop table if exists public.ga4_content_evaluation_cycles;
