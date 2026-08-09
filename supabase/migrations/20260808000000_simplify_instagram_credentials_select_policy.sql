-- instagram_credentials: SELECT ポリシーをオーナー/スタッフ共有パターンから単純化
--
-- 理由（2026-08-08 決定）: 既存スタッフレコード（users.owner_user_id が非 null な行）が実在しないため、
-- 他連携（GSC/GA4/Google Ads 等）が使う get_accessible_user_ids のオーナー/スタッフ共有パターンは不要。
-- Instagram 系テーブル（instagram_credentials/instagram_media/instagram_account_insights_daily）は
-- 一律 user_id = auth.uid() の自己参照のみに揃える（instagram_media/instagram_account_insights_daily は
-- 20260805100000 側で未適用のため直接定義済み。本ファイルは適用済みの instagram_credentials 用）。
--
-- Rollback:
--   drop policy if exists "instagram_credentials_select_own" on public.instagram_credentials;
--   create policy "instagram_credentials_select_own"
--     on public.instagram_credentials for select
--     using (user_id::text = any(public.get_accessible_user_ids((select auth.uid()))));

drop policy if exists "instagram_credentials_select_own" on public.instagram_credentials;

create policy "instagram_credentials_select_own"
  on public.instagram_credentials for select
  using (user_id = (select auth.uid()));
