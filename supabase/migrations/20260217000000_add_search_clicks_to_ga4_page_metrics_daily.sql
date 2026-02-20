-- Add search_clicks to GA4 daily metrics table (idempotent)
-- Rollback:
-- alter table public.ga4_page_metrics_daily drop column if exists search_clicks;

alter table public.ga4_page_metrics_daily
  add column if not exists search_clicks integer not null default 0
  check (search_clicks >= 0);

comment on column public.ga4_page_metrics_daily.search_clicks is
  'Search clicks count (organicGoogleSearchClicks from GA4 API, requires Search Console linkage)';
