-- WordPress の毎日の自動取込（docs/specs/auto-daily-imports-spec.md）用の列。
-- wp_import_baseline_at: 差分取込の基準。前回、最後まで取り込めた回の開始時刻。NULL は次回全件取込。
-- wp_auto_import_status / _at: 自動取込の結果。マイホームの「WordPress の再連携が必要です」の判定に使う。
-- 追加のみで既存の行・処理には影響しない（すべて NULL 可）。
--
-- Rollback:
--   alter table public.wordpress_settings
--     drop column wp_auto_import_status_at,
--     drop column wp_auto_import_status,
--     drop column wp_import_baseline_at;

alter table public.wordpress_settings
  add column wp_import_baseline_at timestamptz,
  add column wp_auto_import_status text
    check (wp_auto_import_status in ('succeeded', 'auth_expired', 'temporary_failure')),
  add column wp_auto_import_status_at timestamptz;
