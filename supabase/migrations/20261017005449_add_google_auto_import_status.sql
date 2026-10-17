-- GSC・GA4 の毎日の自動取込の結果（docs/specs/auto-daily-imports-spec.md FR-011）。
-- マイホームの「<サービス名> の…にアクセスできません」の判定に使う。
-- permission_denied は、トークンは有効なのに Google の API が 403 を返したとき。
-- 権限切れ以外の失敗では書き換えないので temporary_failure は持たない（wordpress_settings と違う）。
-- 追加のみで既存の行・処理には影響しない（すべて NULL 可）。
--
-- Rollback:
--   alter table public.gsc_credentials
--     drop column ga4_auto_import_status_at,
--     drop column ga4_auto_import_status,
--     drop column gsc_auto_import_status_at,
--     drop column gsc_auto_import_status;

alter table public.gsc_credentials
  add column gsc_auto_import_status text
    check (gsc_auto_import_status in ('succeeded', 'permission_denied')),
  add column gsc_auto_import_status_at timestamptz,
  add column ga4_auto_import_status text
    check (ga4_auto_import_status in ('succeeded', 'permission_denied')),
  add column ga4_auto_import_status_at timestamptz;
