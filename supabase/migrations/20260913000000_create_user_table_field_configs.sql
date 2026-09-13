-- 一覧テーブルの「フィールド構成」（表示列・並び順）をユーザー単位で永続化する。
--
-- 従来は localStorage のみに保存しており、次の2点が問題だった。
--   1. 端末・ブラウザをまたぐと引き継がれない
--   2. キーがユーザー単位でないため、同一ブラウザで別アカウントにログインすると
--      前のユーザーの構成をそのまま引き継ぐ
-- 保存先をDBへ移し、どちらも解消する。
--
-- table_key で対象一覧を分ける（'analytics' = コンテンツ一覧 / 'instagram_media' = Instagramメディア一覧）。
-- 対象一覧が増えても列追加のマイグレーションが要らないようにするため。
--
-- Rollback:
--   drop policy if exists "user_table_field_configs_select_own" on public.user_table_field_configs;
--   drop policy if exists "user_table_field_configs_modify_own" on public.user_table_field_configs;
--   drop table if exists public.user_table_field_configs cascade;

create table if not exists public.user_table_field_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  table_key text not null check (table_key in ('analytics', 'instagram_media')),
  -- 表示する列のID。**空配列は「全解除」という正当な状態**なので、空を既定値へ
  -- フォールバックさせてはならない（アプリ側の復元も同じ扱いにしている）。
  visible_ids text[] not null default '{}',
  -- 並び順。既知の列IDだけを保持する。未知IDの除去と新規列の追補はアプリ側で行う
  -- （列カタログは `src/lib/constants.ts` にあり、DBは知らない）。
  ordered_ids text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, table_key)
);

-- RLS の USING 句で使う user_id は unique 制約 (user_id, table_key) の先頭列なので、
-- その複合インデックスが単独検索にも使える。単独インデックスは重複するため作らない。

alter table public.user_table_field_configs enable row level security;

-- 個人のUI設定であり、他ユーザーとは共有しない。
-- owner/staff 共有モデル（get_accessible_user_ids）は廃止済みのため参照しない。
drop policy if exists "user_table_field_configs_select_own" on public.user_table_field_configs;
create policy "user_table_field_configs_select_own"
  on public.user_table_field_configs for select
  using (user_id = (select auth.uid()));

drop policy if exists "user_table_field_configs_modify_own" on public.user_table_field_configs;
create policy "user_table_field_configs_modify_own"
  on public.user_table_field_configs for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
