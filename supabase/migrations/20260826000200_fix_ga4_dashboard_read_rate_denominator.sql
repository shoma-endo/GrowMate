-- ダッシュボードの完読率が上振れする不具合を修正する（レビュー🔴4）。
--
-- 症状: /ga4-dashboard の「完読率」が実態より大きく出る。実測で 0.33% → 30.00%（90倍）。
--
-- 原因: migration 2本の組み合わせ。1本ずつは筋が通っている。
--   - 20260819000300 が既存の scroll_90_event_count = 0 を NULL 化した
--     （「判別できない値は未計測と宣言する」）
--   - 20260821000000 が分母を `sum(users) filter (where scroll_90_event_count is not null)` にした
--     （「未計測の行で薄めない」）
-- 前者で「実測して0回だった日」も NULL になるため、後者の filter が実測0の日を分母から
-- 除外する。分母に残るのは「スクロールが1回以上あった日」だけになる。
--
-- あわせて分母が仕様と違っていた。受領原文 §02 は
--   完読率 = scroll イベント数(90%到達) ÷ sessions
-- と定めるが、ダッシュボードは users を使っていた。取込側が `const users = sessions;`
-- （ga4ImportService.ts:448。totalUsers は landingPage と非互換）としているため今は数値が
-- 同じで潜在バグに留まっているが、users を本物の activeUsers にした瞬間に静かに壊れる。
--
-- 修正: 分母を全期間の sum(sessions) にし、期間内に1日でも未計測があれば read_rate を NULL に
-- 倒す（記事詳細の評価パスと同じ全か無かの方針。ga4-metrics-aggregation.ts:149-163）。
-- 同じ「完読率」が記事詳細・ダッシュボード・一覧で3通りの定義になっていたのを揃える。
--
-- 戻り値の列名 scroll_measured_users は変えない（returns table を変えると PostgREST の
-- キー名が変わり呼び出し側の型も直す必要が出るため）。意味は「完読率の分母。未計測が
-- 混じる場合は 0」であり、users ではなくなっている点に注意する。
--
-- 関数本体は 20260821000000 の定義をそのまま踏襲し、分母の式3箇所だけを変えている。
-- インデックス2本は同 migration で作成済みのため再実行しない。

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
    -- 完読率の分母（レビュー🔴4）。受領原文 §02 は「完読率 = scroll イベント数 ÷ sessions」と
    -- 定めるので分母は sessions。さらに期間内に1日でも未計測（NULL）があれば 0 を返し、
    -- 呼び出し側（ga4-dashboard-mapping.ts）で null＝「—」になるようにする。
    -- 旧実装は `sum(users) filter (scroll is not null)` で、20260819000300 が実測0を NULL 化した
    -- 結果「スクロールが1回以上あった日」だけが分母に残り、完読率が跳ね上がっていた（実測90倍）。
    case when bool_or(m.scroll_90_event_count is null) then 0
         else coalesce(sum(m.sessions), 0) end::bigint,
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
      -- 分母は sessions（受領原文 §02）。期間内に1日でも未計測なら 0 にして read_rate を
      -- NULL に倒す（評価パス ga4-metrics-aggregation.ts:149-163 と同じ全か無かの方針）。
      (case when bool_or(m.scroll_90_event_count is null) then 0
            else sum(m.sessions) end)::bigint as scroll_measured_users,
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
      -- 分母は sessions（受領原文 §02）。期間内に1日でも未計測なら 0 にして read_rate を
      -- NULL に倒す（評価パス ga4-metrics-aggregation.ts:149-163 と同じ全か無かの方針）。
      (case when bool_or(m.scroll_90_event_count is null) then 0
            else sum(m.sessions) end)::bigint as scroll_measured_users,
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
revoke execute on function public.get_ga4_dashboard_summary(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_summary(uuid, text, date, date) to service_role;

revoke execute on function public.get_ga4_dashboard_ranking(uuid, text, date, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_ranking(uuid, text, date, date, text, integer, integer) to service_role;

revoke execute on function public.get_ga4_dashboard_timeseries(uuid, text, date, date, text) from public, anon, authenticated;
grant execute on function public.get_ga4_dashboard_timeseries(uuid, text, date, date, text) to service_role;
