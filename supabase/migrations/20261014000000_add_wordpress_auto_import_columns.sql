alter table public.wordpress_settings
  add column wp_import_baseline_at timestamptz,
  add column wp_auto_import_status text
    check (wp_auto_import_status in ('succeeded', 'auth_expired', 'temporary_failure')),
  add column wp_auto_import_status_at timestamptz;
