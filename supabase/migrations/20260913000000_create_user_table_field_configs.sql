-- 一覧テーブルの「フィールド構成」（表示列・並び順）をユーザー単位で永続化する。
--
-- 従来は localStorage のみに保存しており、次の2点が問題だった。
--   1. 端末・ブラウザをまたぐと引き継がれない
--   2. キーがユーザー単位でないため、同一ブラウザで別アカウントにログインすると
--      前のユーザーの構成をそのまま引き継ぐ
-- 保存先をDBへ移し、どちらも解消する。
--
-- table_key で対象一覧を分ける（'analytics' = コンテンツ一覧 / 'instagram_media' = Instagramメディア一覧）。
-- 行方向に持つので、対象一覧が増えても**列を足す必要がない**（1一覧 = 1行）。
-- 列カタログ自体は `src/lib/constants.ts` が正本で、DBは中身を知らない。
--
-- 対象一覧を追加するときの手順:
--   1. このマイグレーションではなく**新しいマイグレーション**で check 制約を張り替える
--        alter table public.user_table_field_configs
--          drop constraint user_table_field_configs_table_key_check;
--        alter table public.user_table_field_configs
--          add constraint user_table_field_configs_table_key_check
--          check (table_key in ('analytics', 'instagram_media', '<新しいkey>'));
--   2. `src/types/field-config.ts` の `FieldConfigTableKey` に union を足す
--   3. `src/lib/constants.ts` に `FIELD_CONFIG_TABLE_KEYS` のエントリと列カタログを足す
--   4. `src/server/schemas/fieldConfig.schema.ts` の `COLUMN_IDS_BY_TABLE_KEY` に足す
--      （`Record<FieldConfigTableKey, ...>` なので足し忘れは tsc が落とす。
--        Server Action が受け付ける tableKey もここから導出される）
--
-- Rollback:
--   drop policy if exists "user_table_field_configs_select_own" on public.user_table_field_configs;
--   drop policy if exists "user_table_field_configs_modify_own" on public.user_table_field_configs;
--   drop table if exists public.user_table_field_configs cascade;

create table if not exists public.user_table_field_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  table_key text not null,
  -- 表示する列のID。**空配列は「全解除」という正当な状態**なので、空を既定値へ
  -- フォールバックさせてはならない（アプリ側の復元も同じ扱いにしている）。
  visible_ids text[] not null default '{}',
  -- 並び順。既知の列IDだけを保持する。未知IDの除去と新規列の追補はアプリ側で行う
  -- （列カタログは `src/lib/constants.ts` にあり、DBは知らない）。
  ordered_ids text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, table_key),
  -- **制約に名前を付ける。** 対象一覧を足すときに張り替えるので、
  -- 自動生成名を調べずに済むようにしておく（上の「追加するときの手順」を参照）
  constraint user_table_field_configs_table_key_check
    check (table_key in ('analytics', 'instagram_media'))
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
