-- ブログ一覧（/analytics）を列見出しで並べ替えられるようにする。
--
-- 並べ替えできる列（p_sort_key。一覧の列 id と同じ）:
--   impressions              表示回数（content_annotations.impressions。利用者が入力する text）
--   ga4_avg_engagement_time  滞在時間（平均）
--   ga4_read_rate            完読率
--   ga4_engagement_rate      エンゲージメント率
--   ga4_cv_count             問い合わせ数
--   ga4_cvr                  問い合わせ率
--   ga4_evaluation_status    コンテンツ評価状態
--   ga4_content_score        コンテンツ力スコア
-- p_sort_key が null・許可外なら従来どおり updated_at の降順。
--
-- GA4 の5列は画面と同じく「一覧の期間（p_start_date〜p_end_date）」で集計した値で並べる。
-- アプリは表示中の10件だけを ga4-metrics-aggregation.ts で集計しているため、ページを
-- またいで並べるにはここで全件を集計する必要がある。式はアプリ側と同じ意味にそろえる
-- （AnalyticsTable.tsx の avgEngagementSeconds / readRate / cvr と
--   aggregateGa4PageMetrics の engagementRate・完読率の全か無か）。
--
-- 値が無い行（GA4 のデータが無い・未計測・表示回数が数値として読めない）は、
-- 昇順・降順どちらでも末尾に置く。同じ値の中は updated_at の降順 → id で並べ、
-- ページ送りで行が重複・欠落しないようにする。
--
-- 引数リストが変わるため、同名関数を全 oid 走査して drop してから作り直す
-- （20260831010000 の「再発防止」に従う。列挙方式は取りこぼす）。
-- drop で権限も消えるため、末尾の revoke / grant を必ず再実行する。
do $$
declare
  fn record;
begin
  for fn in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_filtered_content_annotations'
  loop
    execute format('drop function public.get_filtered_content_annotations(%s)', fn.args);
  end loop;
end $$;

create or replace function public.get_filtered_content_annotations(
  p_user_id uuid,
  p_page integer,
  p_per_page integer,
  p_selected_category_names text[] default '{}'::text[],
  p_include_uncategorized boolean default false,
  p_has_unread_suggestion boolean default false,
  p_has_unstarted_gsc_evaluation boolean default false,
  p_has_unstarted_ga4_evaluation boolean default false,
  p_has_unsummarized boolean default false,
  p_sort_key text default null,
  p_sort_order text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns table(items jsonb, total_count bigint)
language sql stable
as $$
  with normalized as (
    select
      greatest(1, coalesce(p_page, 1)) as page,
      greatest(1, least(100, coalesce(p_per_page, 100))) as per_page,
      coalesce((select array_agg(trimmed_name) from (
        select distinct trim(name) as trimmed_name
        from unnest(coalesce(p_selected_category_names, '{}'::text[])) as name
        where trim(name) <> ''
      ) names), '{}'::text[]) as selected_names,
      coalesce(p_include_uncategorized, false) as include_uncategorized,
      coalesce(p_has_unread_suggestion, false) as has_unread_suggestion,
      coalesce(p_has_unstarted_gsc_evaluation, false) as has_unstarted_gsc_evaluation,
      coalesce(p_has_unstarted_ga4_evaluation, false) as has_unstarted_ga4_evaluation,
      coalesce(p_has_unsummarized, false) as has_unsummarized,
      -- btrim で落とす空白文字の集合（上の未要約述語のコメントを参照）
      ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(12288) as blank,
      case
        when p_sort_key in (
          'impressions', 'ga4_avg_engagement_time', 'ga4_read_rate', 'ga4_engagement_rate',
          'ga4_cv_count', 'ga4_cvr', 'ga4_evaluation_status', 'ga4_content_score'
        ) then p_sort_key
      end as sort_key,
      case when p_sort_order = 'asc' then 'asc' else 'desc' end as sort_order,
      -- GA4 の集計が要る並べ替えか。下の ga4_metrics は同じ条件を**引数で直接**持つ
      -- （この列を参照すると行ごとの判定になり、GA4 以外の並べ替えでも日次行を全件読む）
      p_sort_key in (
        'ga4_avg_engagement_time', 'ga4_read_rate', 'ga4_engagement_rate', 'ga4_cv_count', 'ga4_cvr'
      ) and p_start_date is not null and p_end_date is not null and p_start_date <= p_end_date
        as needs_ga4_metrics
  ), filtered as (
    select ca.*
    from public.content_annotations ca
    cross join normalized n
    cross join lateral (
      select coalesce(array_agg(trim(category_name)) filter (where trim(category_name) <> ''), '{}'::text[]) as names
      from unnest(coalesce(ca.wp_category_names, '{}'::text[])) as category_name
    ) categories
    where ca.user_id = p_user_id::text
      and (
        (coalesce(array_length(n.selected_names, 1), 0) = 0 and not n.include_uncategorized)
        or (coalesce(array_length(n.selected_names, 1), 0) > 0 and categories.names && n.selected_names)
        or (n.include_uncategorized and coalesce(array_length(categories.names, 1), 0) = 0)
      )
      and (
        not n.has_unread_suggestion
        or exists (
          select 1 from public.gsc_article_evaluation_history h
          where h.content_annotation_id = ca.id and h.user_id = p_user_id
            and h.is_read = false and h.outcome_type <> 'error'
            and h.outcome is not null and h.outcome <> 'improved'
        )
      )
      and (
        not n.has_unstarted_gsc_evaluation
        or not exists (
          select 1 from public.gsc_article_evaluations e
          where e.content_annotation_id = ca.id
        )
      )
      and (
        not n.has_unstarted_ga4_evaluation
        or not exists (
          select 1 from public.ga4_content_evaluations e
          where e.content_annotation_id = ca.id and e.user_id = p_user_id
        )
      )
      -- 未要約（BR-02）: 8項目すべてが空 かつ WordPress 連携済み。
      -- 空白の扱いは 20260831000000 のコメントを参照（JS の trim に寄せている）
      and (
        not n.has_unsummarized
        or (
          coalesce(btrim(ca.main_kw, n.blank), '') = ''
          and coalesce(btrim(ca.kw, n.blank), '') = ''
          and coalesce(btrim(ca.needs, n.blank), '') = ''
          and coalesce(btrim(ca.persona, n.blank), '') = ''
          and coalesce(btrim(ca.goal, n.blank), '') = ''
          and coalesce(btrim(ca.prep, n.blank), '') = ''
          and coalesce(btrim(ca.opening_proposal, n.blank), '') = ''
          and coalesce(btrim(ca.basic_structure, n.blank), '') = ''
          and (
            coalesce(ca.wp_post_id, 0) > 0
            or coalesce(btrim(ca.canonical_url, n.blank), '') <> ''
          )
        )
      )
  ), ga4_metrics as (
    -- 一覧の GA4 表示（analyticsContentService.fetchGa4Summaries）と同じく、
    -- gsc_credentials の GA4 プロパティ × 期間で記事（normalized_path）ごとに集計する
    select
      m.normalized_path,
      sum(m.sessions)::numeric as sessions,
      sum(m.users)::numeric as users,
      sum(m.engagement_time_sec)::numeric as engagement_time_sec,
      sum(m.cv_event_count)::numeric as cv_event_count,
      sum(m.scroll_90_event_count)::numeric as scroll_90_event_count,
      -- 完読率は期間内に1日でも未計測（null）があれば値なし（ga4-metrics-aggregation.ts の全か無か）
      bool_or(m.scroll_90_event_count is null) as scroll_partially_missing,
      sum(m.engagement_rate * m.sessions) filter (where m.engagement_rate is not null)::numeric
        as engagement_rate_weighted,
      sum(m.sessions) filter (where m.engagement_rate is not null)::numeric
        as engagement_rate_sessions
    from public.ga4_page_metrics_daily m
    join public.gsc_credentials gc
      on gc.user_id = p_user_id and gc.ga4_property_id = m.property_id
    -- 引数だけの条件なので planner が One-Time Filter にし、不要なら日次行を読まない。
    -- normalized.needs_ga4_metrics と同じ条件（片方だけ直さないこと）
    where p_sort_key in (
        'ga4_avg_engagement_time', 'ga4_read_rate', 'ga4_engagement_rate', 'ga4_cv_count', 'ga4_cvr'
      )
      and p_start_date is not null and p_end_date is not null and p_start_date <= p_end_date
      and m.user_id = p_user_id
      and m.date >= p_start_date
      and m.date <= p_end_date
      and m.normalized_path is not null
    group by m.normalized_path
  ), with_latest as (
    select
      f.*,
      latest.status as ga4_evaluation_status,
      latest.content_score as ga4_content_score,
      latest.diagnosis_code as ga4_diagnosis_code,
      latest.evaluated_at as ga4_last_evaluated_at
    from filtered f
    left join lateral (
      select ev.status, h.content_score, h.diagnosis_code, h.completed_at as evaluated_at
      from public.ga4_content_evaluations ev
      left join public.ga4_content_evaluation_history h on h.id = ev.last_success_history_id
      where ev.user_id = p_user_id and ev.content_annotation_id = f.id
    ) latest on true
  ), ordered as (
    select
      w.*,
      row_number() over (
        order by
          case when n.sort_order = 'asc' then sort_value.value end asc nulls last,
          case when n.sort_order = 'desc' then sort_value.value end desc nulls last,
          w.updated_at desc nulls last,
          w.id
      ) as rn
    from with_latest w
    cross join normalized n
    left join ga4_metrics gm
      on n.needs_ga4_metrics
      -- 空白の扱いは上の未要約述語と同じ集合（アプリの String.prototype.trim にほぼ寄せたもの）
      and coalesce(btrim(w.canonical_url, n.blank), '') <> ''
      and gm.normalized_path = public.normalize_to_path(w.canonical_url)
    cross join lateral (
      select case n.sort_key
        -- 利用者の入力値。桁区切り（, ，）と全角数字を許して数値として読めるものだけ並べる
        when 'impressions' then (
          select case when cleaned ~ '^[0-9]+(\.[0-9]+)?$' then cleaned::numeric end
          from (
            select translate(
              regexp_replace(coalesce(btrim(w.impressions, n.blank), ''), '[,，]', '', 'g'),
              '０１２３４５６７８９．',
              '0123456789.'
            ) as cleaned
          ) parsed
        )
        -- 画面と同じく、データはあるがセッション0なら 0 秒・0%（「—」ではない）
        when 'ga4_avg_engagement_time' then case
          when gm.normalized_path is not null then
            case when gm.sessions > 0 then gm.engagement_time_sec / gm.sessions else 0 end
        end
        when 'ga4_read_rate' then case
          when gm.sessions > 0 and not gm.scroll_partially_missing
            then gm.scroll_90_event_count / gm.sessions
        end
        when 'ga4_engagement_rate' then
          gm.engagement_rate_weighted / nullif(gm.engagement_rate_sessions, 0)
        when 'ga4_cv_count' then gm.cv_event_count
        when 'ga4_cvr' then case
          when gm.normalized_path is not null then
            case when gm.users > 0 then gm.cv_event_count / gm.users else 0 end
        end
        -- 進み具合の順（降順で 評価済み → 評価中 → 診断コメント作成失敗 → データ不足 →
        -- データ取得失敗 → 評価失敗 → 未評価）。未評価も並べる対象なので null にしない
        when 'ga4_evaluation_status' then case w.ga4_evaluation_status
          when 'evaluated' then 6
          when 'evaluating' then 5
          when 'narrative_failed' then 4
          when 'insufficient_data' then 3
          when 'import_failed' then 2
          when 'evaluation_failed' then 1
          else 0
        end
        when 'ga4_content_score' then w.ga4_content_score::numeric
      end as value
    ) sort_value
  ), paged as (
    select to_jsonb(o.*) as annotation, o.rn
    from ordered o cross join normalized n
    where o.rn > (n.page - 1) * n.per_page and o.rn <= n.page * n.per_page
  )
  select coalesce((select jsonb_agg(p.annotation order by p.rn) from paged p), '[]'::jsonb),
         coalesce((select count(*) from filtered), 0)::bigint;
$$;

revoke execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean, text, text, date, date) from public, anon, authenticated;
grant execute on function public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean, text, text, date, date) to service_role;

-- 1本だけ残り、service_role だけが実行できることを確かめる（想定外なら適用を失敗させる）
do $$
declare
  fn_count integer;
  fn_oid oid;
begin
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_filtered_content_annotations';

  if fn_count <> 1 then
    raise exception 'get_filtered_content_annotations は1本だけ残るはずが % 本ある', fn_count;
  end if;

  select p.oid into fn_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_filtered_content_annotations';
  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が get_filtered_content_annotations を実行できない';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'anon が get_filtered_content_annotations を実行できてしまう（revoke 漏れ）';
  end if;
end $$;

-- Rollback: 13引数版を drop し、20260831000000_add_unsummarized_filter_to_get_filtered_content_annotations.sql を
-- ファイル全体で再適用する（同ファイルは末尾に9引数版の revoke / grant を持つため権限も戻る）。
--   drop function if exists public.get_filtered_content_annotations(uuid, integer, integer, text[], boolean, boolean, boolean, boolean, boolean, text, text, date, date);
-- アプリが並べ替えの引数（p_sort_key 等）を送るのは並べ替え中だけなので、戻しても既定の一覧は動く。
