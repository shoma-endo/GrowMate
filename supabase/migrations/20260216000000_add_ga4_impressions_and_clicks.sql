-- Add impressions, clicks (search_clicks), and CTR to GA4 metrics
-- This adds support for tracking search impressions and clicks from Search Console integration

-- Add search_clicks column (clicks = organicGoogleSearchClicks from GA4 API)
alter table public.ga4_page_metrics_daily
  add column if not exists search_clicks integer not null default 0 check (search_clicks >= 0);
-- Rollback: alter table public.ga4_page_metrics_daily drop column if exists search_clicks;

-- Add impressions column (organicGoogleSearchImpressions from GA4 API)
alter table public.ga4_page_metrics_daily
  add column if not exists impressions integer not null default 0 check (impressions >= 0);
-- Rollback: alter table public.ga4_page_metrics_daily drop column if exists impressions;

-- Add ctr column (calculated as search_clicks / impressions)
-- numeric(10,9) allows up to 999.999999999 (CTR can exceed 100% in some cases)
alter table public.ga4_page_metrics_daily
  add column if not exists ctr numeric(10,9);
-- Rollback: alter table public.ga4_page_metrics_daily drop column if exists ctr;

-- Add comments
comment on column public.ga4_page_metrics_daily.search_clicks is 'Search clicks count (organicGoogleSearchClicks from GA4 API, requires Search Console linkage)';
comment on column public.ga4_page_metrics_daily.impressions is 'Search impressions count (organicGoogleSearchImpressions from GA4 API, requires Search Console linkage)';
comment on column public.ga4_page_metrics_daily.ctr is 'Click-through rate (search_clicks / impressions, 0-1 ratio, NULL when impressions = 0, displayed as percentage)';
