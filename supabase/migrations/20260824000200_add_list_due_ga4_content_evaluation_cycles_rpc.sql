-- 定期評価バッチのdue抽出RPC(§8.3処理順序1)。
-- ロール絞り込みをSQL側で行う理由(§8.3「ロール絞り込みをSQL側へ置く理由」): アプリ側フィルタだけだと
-- trial/unavailableへ降格したユーザーのサイクル行が毎時due抽出され続け、last_evaluated_onが進まないため
-- next_evaluation_dateが過去のまま昇順の先頭に居座り、1,000行枠(db-max-rows)を恒久占有する(R-17)。
-- next_evaluation_date == p_today_jst の行はevaluation_hourの判定をアプリ側で行う(§6.6.2)ため、
-- ここでは日付のみで絞り込む。

create or replace function public.list_due_ga4_content_evaluation_cycles(
  p_today_jst date,
  p_limit integer,
  p_offset integer
)
returns table(
  id uuid,
  user_id uuid,
  content_annotation_id uuid,
  base_evaluation_date date,
  cycle_days integer,
  evaluation_hour smallint,
  last_evaluated_on date,
  next_evaluation_date date
)
language sql stable
as $$
  select
    c.id, c.user_id, c.content_annotation_id, c.base_evaluation_date,
    c.cycle_days, c.evaluation_hour, c.last_evaluated_on, c.next_evaluation_date
  from public.ga4_content_evaluation_cycles c
  join public.users u on u.id = c.user_id
  where c.status = 'active'
    and c.next_evaluation_date <= p_today_jst
    and u.role in ('admin', 'paid')
  order by c.next_evaluation_date asc, c.id asc
  limit p_limit offset p_offset;
$$;

revoke execute on function public.list_due_ga4_content_evaluation_cycles(date, integer, integer) from public, anon, authenticated;
grant execute on function public.list_due_ga4_content_evaluation_cycles(date, integer, integer) to service_role;

-- Rollback: drop function if exists public.list_due_ga4_content_evaluation_cycles(date, integer, integer);
