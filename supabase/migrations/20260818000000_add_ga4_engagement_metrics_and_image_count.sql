-- GA4評価用の追加指標とWordPress本文の画像点数。
alter table public.ga4_page_metrics_daily
  add column if not exists engagement_rate numeric(5,4) null
    check (engagement_rate >= 0 and engagement_rate <= 1);
-- Rollback: alter table public.ga4_page_metrics_daily drop column if exists engagement_rate;

alter table public.ga4_page_metrics_daily
  add column if not exists active_users integer null
    check (active_users >= 0);
-- Rollback: alter table public.ga4_page_metrics_daily drop column if exists active_users;

alter table public.content_annotations
  add column if not exists wp_image_count integer null
    check (wp_image_count >= 0);
-- Rollback: alter table public.content_annotations drop column if exists wp_image_count;

comment on column public.ga4_page_metrics_daily.engagement_rate is 'GA4 engagementRate（landingPage軸）';
comment on column public.ga4_page_metrics_daily.active_users is 'GA4 activeUsers（landingPage軸）';
comment on column public.content_annotations.wp_image_count is 'WordPress本文のimgタグ数';
