-- list_due_ga4_content_evaluations だけが、同じPRで追加した他のRPCと堅牢化パターンが揃って
-- いなかったのを修正する（レビュー🟡）。
--
-- 20260826000000 の定義は `language sql stable` のみで、`security definer` も
-- `set search_path` も `auth.role()` ガードも無い。一方、同PRの他7本
-- （start / finish / update_attempt / cancel_ga4_content_evaluation、
--   get_ga4_dashboard_summary / _ranking / _timeseries）は3点セットで揃えている。
--
-- 実害の見積もり: execute は service_role のみに絞ってあるため、即座に悪用できる経路は無い。
-- ただしこの関数は **`u.role in ('admin','paid')` という本機能のロール規約を担保する唯一のSQL**
-- であり、堅牢化パターンから外れていること自体が将来の事故の余地になる。とくに
-- `set search_path` が無いと、検索パス上に同名オブジェクトを作れる立場からの差し替えを防げない。
--
-- 変更点は3つだけで、返す行の中身（where 句・order by）は 20260826000000 と同一。
--   1. security definer を付ける
--   2. set search_path = public で検索パスを固定する
--   3. 冒頭で auth.role() <> 'service_role' を弾く（grant と二重の防御）
--
-- security definer にするため language を sql から plpgsql へ変える。ガードに if 文が要るため。

create or replace function public.list_due_ga4_content_evaluations(
  p_today_jst date
)
returns table(
  id uuid,
  user_id uuid,
  content_annotation_id uuid,
  base_evaluation_date date,
  cycle_days integer,
  evaluation_hour smallint,
  ga4_last_evaluated_on date,
  ga4_last_seen_content_score integer,
  ga4_next_evaluation_date date
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
    e.id, e.user_id, e.content_annotation_id, e.base_evaluation_date,
    e.cycle_days, e.evaluation_hour, e.ga4_last_evaluated_on, e.ga4_last_seen_content_score,
    (coalesce(e.ga4_last_evaluated_on, e.base_evaluation_date)::date
      + coalesce(e.cycle_days, 30))::date as ga4_next_evaluation_date
  from public.gsc_article_evaluations e
  join public.users u on u.id = e.user_id
  where e.status = 'active'
    and (coalesce(e.ga4_last_evaluated_on, e.base_evaluation_date)::date
          + coalesce(e.cycle_days, 30)) <= p_today_jst
    and u.role in ('admin', 'paid')
    and exists (
      select 1
      from public.gsc_credentials c
      where c.user_id = e.user_id
        and c.ga4_property_id is not null
    )
  order by ga4_next_evaluation_date asc, e.id asc;
end;
$$;

revoke execute on function public.list_due_ga4_content_evaluations(date) from public, anon, authenticated;
grant execute on function public.list_due_ga4_content_evaluations(date) to service_role;

-- 検証SQL（ローカルで実行する）:
--   set request.jwt.role = 'authenticated';
--   select * from list_due_ga4_content_evaluations(current_date);  -- 'service role required' で失敗すればOK
--   set request.jwt.role = 'service_role';
--   select count(*) from list_due_ga4_content_evaluations(current_date);  -- 通ればOK
--
-- Rollback: 20260826000000_merge_ga4_content_evaluation_into_gsc_cycle.sql の
-- list_due_ga4_content_evaluations 定義（language sql stable）を再適用する。
-- 述語は同一のため、戻しても抽出結果は変わらない。
