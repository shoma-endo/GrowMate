-- /ga4-dashboard の集計を DB 側で完結させる。
--
-- これまで ga4Dashboard.actions.ts は ga4_page_metrics_daily の日次行を
-- `.select()` で素朴に取得し、アプリ側で集計していた。PostgREST には
-- `db-max-rows = 1000` のグローバル上限があるため（docs/context/db-row-limits-and-data-truncation.md）、
-- 1000 行を超えた期間は黙って打ち切られ、サマリー・ランキング・時系列の数値が
-- 過少になっていた。`order` を指定していないためどの行が落ちるかも不定で、
-- 再取得のたびに数値が変わりうる。実測（2026-08-21）:
--   直近30日  565 行 /  565 行  影響なし
--   直近90日 1000 行 / 1625 行  625 行が欠落
--   全期間   1000 行 / 2441 行  1441 行が欠落
-- 記事315件規模では1日あたり数百パスになるため、30日表示でも超える。
--
-- 集計を GROUP BY で DB 側に寄せ、返却行数を「パス数」「日数」に有界化する。
-- ランキングは total_count を併せて返し、画面のページネーションを可能にする。
--
-- BR-02: scroll_90_event_count の NULL は「未計測」であり 0（実測0回）ではない。
-- 完読率の分母は「計測できた行の users 合計」だけを使い、未計測の行で薄めない。

-- ---------------------------------------------------------------- サマリー

create or replace function public.get_ga4_dashboard_summary(
  p_user_id uuid,
  p_property_id text,
  p_start date,
  p_end date
)
returns table(
  total_sessions bigint,
  total_users bigint,
  total_engagement_time_sec bigint,
  total_cv_event_count bigint,
  total_scroll_90_event_count bigint,
  scroll_measured_users bigint,
  total_search_clicks bigint,
  total_impressions bigint,
  has_sampled_data boolean,
  has_partial_data boolean,
  row_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  select
    coalesce(sum(m.sessions), 0)::bigint,
    coalesce(sum(m.users), 0)::bigint,
    coalesce(sum(m.engagement_time_sec), 0)::bigint,
    coalesce(sum(m.cv_event_count), 0)::bigint,
    coalesce(sum(m.scroll_90_event_count), 0)::bigint,
    coalesce(sum(m.users) filter (where m.scroll_90_event_count is not null), 0)::bigint,
    coalesce(sum(m.search_clicks), 0)::bigint,
    coalesce(sum(m.impressions), 0)::bigint,
    coalesce(bool_or(m.is_sampled), false),
    coalesce(bool_or(m.is_partial), false),
    count(*)::bigint
  from public.ga4_page_metrics_daily m
  where m.user_id = p_user_id
    and m.property_id = p_property_id
    and m.date >= p_start
    and m.date <= p_end;
end;
$$;
-- Rollback: drop function if exists public.get_ga4_dashboard_summary(uuid, text, date, date);

-- ---------------------------------------------------------------- ランキング

create or replace function public.get_ga4_dashboard_ranking(
  p_user_id uuid,
  p_property_id text,
  p_start date,
  p_end date,
  p_sort text,
  p_limit integer,
  p_offset integer
)
returns table(
  normalized_path text,
  annotation_id uuid,
  title text,
  sessions bigint,
  users bigint,
  avg_engagement_time_sec numeric,
  cv_event_count bigint,
  cvr numeric,
  read_rate numeric,
  search_clicks bigint,
  impressions bigint,
  ctr numeric,
  is_sampled boolean,
  is_partial boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_offset < 0 then
    raise exception 'p_offset must be >= 0';
  end if;

  return query
  with aggregated as (
    select
      m.normalized_path as path,
      sum(m.sessions)::bigint as sessions,
      sum(m.users)::bigint as users,
      sum(m.engagement_time_sec)::bigint as engagement_time_sec,
      sum(m.cv_event_count)::bigint as cv_event_count,
      sum(m.scroll_90_event_count)::bigint as scroll_90_event_count,
      (sum(m.users) filter (where m.scroll_90_event_count is not null))::bigint as scroll_measured_users,
      sum(m.search_clicks)::bigint as search_clicks,
      sum(m.impressions)::bigint as impressions,
      bool_or(m.is_sampled) as is_sampled,
      bool_or(m.is_partial) as is_partial
    from public.ga4_page_metrics_daily m
    where m.user_id = p_user_id
      and m.property_id = p_property_id
      and m.date >= p_start
      and m.date <= p_end
      and m.normalized_path is not null
    group by m.normalized_path
  ),
  derived as (
    select
      a.path,
      a.sessions,
      a.users,
      case when a.sessions > 0 then a.engagement_time_sec::numeric / a.sessions else 0 end as avg_engagement_time_sec,
      a.cv_event_count,
      case when a.users > 0 then (a.cv_event_count::numeric / a.users) * 100 else 0 end as cvr,
      -- 未計測しかない記事は NULL。0% と書かない（BR-02）
      case when a.scroll_measured_users > 0
        then (a.scroll_90_event_count::numeric / a.scroll_measured_users) * 100
      end as read_rate,
      a.search_clicks,
      a.impressions,
      case when a.impressions > 0 then a.search_clicks::numeric / a.impressions end as ctr,
      a.is_sampled,
      a.is_partial,
      (count(*) over ())::bigint as total_count
    from aggregated a
  )
  select
    d.path,
    ann.id,
    ann.wp_post_title,
    d.sessions,
    d.users,
    d.avg_engagement_time_sec,
    d.cv_event_count,
    d.cvr,
    d.read_rate,
    d.search_clicks,
    d.impressions,
    d.ctr,
    d.is_sampled,
    d.is_partial,
    d.total_count
  from derived d
  left join lateral (
    select c.id, c.wp_post_title
    from public.content_annotations c
    where c.user_id = p_user_id::text
      and c.canonical_url is not null
      and public.normalize_to_path(c.canonical_url) = d.path
    order by c.updated_at desc nulls last, c.id
    limit 1
  ) ann on true
  order by
    -- 指定キーで降順。NULL は末尾（BR-02。読了率の未計測を 0% として並べない）
    case when p_sort = 'sessions' then d.sessions end desc nulls last,
    case when p_sort = 'cvr' then d.cvr end desc nulls last,
    case when p_sort = 'readRate' then d.read_rate end desc nulls last,
    case when p_sort = 'avgEngagementTimeSec' then d.avg_engagement_time_sec end desc nulls last,
    d.sessions desc,
    -- ページ間で行が重複・欠落しないよう一意キーで固定する
    d.path asc
  limit p_limit
  offset p_offset;
end;
$$;
-- Rollback: drop function if exists public.get_ga4_dashboard_ranking(uuid, text, date, date, text, integer, integer);

-- ---------------------------------------------------------------- 時系列

create or replace function public.get_ga4_dashboard_timeseries(
  p_user_id uuid,
  p_property_id text,
  p_start date,
  p_end date,
  p_normalized_path text
)
returns table(
  date date,
  sessions bigint,
  users bigint,
  avg_engagement_time_sec numeric,
  cv_event_count bigint,
  cvr numeric,
  read_rate numeric,
  search_clicks bigint,
  impressions bigint,
  ctr numeric,
  is_sampled boolean,
  is_partial boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  with aggregated as (
    select
      m.date as d,
      sum(m.sessions)::bigint as sessions,
      sum(m.users)::bigint as users,
      sum(m.engagement_time_sec)::bigint as engagement_time_sec,
      sum(m.cv_event_count)::bigint as cv_event_count,
      sum(m.scroll_90_event_count)::bigint as scroll_90_event_count,
      (sum(m.users) filter (where m.scroll_90_event_count is not null))::bigint as scroll_measured_users,
      sum(m.search_clicks)::bigint as search_clicks,
      sum(m.impressions)::bigint as impressions,
      bool_or(m.is_sampled) as is_sampled,
      bool_or(m.is_partial) as is_partial
    from public.ga4_page_metrics_daily m
    where m.user_id = p_user_id
      and m.property_id = p_property_id
      and m.date >= p_start
      and m.date <= p_end
      and m.normalized_path = p_normalized_path
    group by m.date
  )
  select
    a.d,
    a.sessions,
    a.users,
    case when a.sessions > 0 then a.engagement_time_sec::numeric / a.sessions else 0 end,
    a.cv_event_count,
    case when a.users > 0 then (a.cv_event_count::numeric / a.users) * 100 else 0 end,
    case when a.scroll_measured_users > 0
      then (a.scroll_90_event_count::numeric / a.scroll_measured_users) * 100
    end,
    a.search_clicks,
    a.impressions,
    case when a.impressions > 0 then a.search_clicks::numeric / a.impressions end,
    a.is_sampled,
    a.is_partial
  from aggregated a
  order by a.d asc;
end;
$$;
-- Rollback: drop function if exists public.get_ga4_dashboard_timeseries(uuid, text, date, date, text);

-- ---------------------------------------------------------------- 索引

-- ランキング・時系列は (user_id, property_id, 期間) で絞ってから GROUP BY する。
-- 既存の idx_ga4_metrics_user_date は property_id を含まない
create index if not exists idx_ga4_metrics_user_property_date
  on public.ga4_page_metrics_daily(user_id, property_id, date);
-- Rollback: drop index if exists public.idx_ga4_metrics_user_property_date;

-- 突合用。canonical_url を正規化した値での等値検索を効かせる
create index if not exists idx_content_annotations_normalized_canonical
  on public.content_annotations(user_id, (public.normalize_to_path(canonical_url)))
  where canonical_url is not null;
-- Rollback: drop index if exists public.idx_content_annotations_normalized_canonical;

-- ---------------------------------------------------------------- 権限

revoke execute on function public.get_ga4_dashboard_summary(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_summary(uuid, text, date, date) to service_role;

revoke execute on function public.get_ga4_dashboard_ranking(uuid, text, date, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_ranking(uuid, text, date, date, text, integer, integer) to service_role;

revoke execute on function public.get_ga4_dashboard_timeseries(uuid, text, date, date, text) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_timeseries(uuid, text, date, date, text) to service_role;
