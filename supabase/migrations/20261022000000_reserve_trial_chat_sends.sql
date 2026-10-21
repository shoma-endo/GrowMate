-- trial の1日の送信回数は、送信（通常・続き生成とも）を生成の前に予約した件数で数える。
-- 確認と予約を別々に行うと、同時に送った分だけ確認をすり抜けるため、数えて空きがあれば1件入れるまでを1回の関数で行う。
alter table public.chat_continuation_events rename to trial_chat_send_reservations;
alter index public.idx_chat_continuation_events_user_created_at
  rename to idx_trial_chat_send_reservations_user_created_at;
alter table public.trial_chat_send_reservations
  rename constraint chat_continuation_events_pkey to trial_chat_send_reservations_pkey;
alter table public.trial_chat_send_reservations
  rename constraint chat_continuation_events_user_id_fkey to trial_chat_send_reservations_user_id_fkey;

create or replace function public.reserve_trial_chat_send(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  -- 同じユーザーの予約だけを直列にする（トランザクションの終わりで外れる）
  perform pg_advisory_xact_lock(hashtextextended('reserve_trial_chat_send:' || p_user_id::text, 0));

  select count(*) into v_count
    from public.trial_chat_send_reservations
   where user_id = p_user_id
     and created_at >= p_from
     and created_at < p_to;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.trial_chat_send_reservations (user_id) values (p_user_id);
  return true;
end;
$$;

revoke execute on function public.reserve_trial_chat_send(uuid, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_trial_chat_send(uuid, timestamptz, timestamptz, integer) to service_role;

-- 想定どおりの権限になったかを確かめる（想定外なら適用を失敗させる）
do $$
declare
  fn_oid oid := 'public.reserve_trial_chat_send(uuid,timestamptz,timestamptz,integer)'::regprocedure;
  tbl_oid oid := 'public.trial_chat_send_reservations'::regclass;
begin
  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が reserve_trial_chat_send を実行できない';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'anon / authenticated が reserve_trial_chat_send を実行できてしまう（revoke 漏れ）';
  end if;
  if not (select relrowsecurity from pg_class where oid = tbl_oid) then
    raise exception 'trial_chat_send_reservations の RLS が無効になっている';
  end if;
  if has_table_privilege('anon', tbl_oid, 'select') or has_table_privilege('authenticated', tbl_oid, 'select') then
    raise exception 'anon / authenticated が trial_chat_send_reservations を読めてしまう';
  end if;
end $$;

-- Rollback:
--   drop function public.reserve_trial_chat_send(uuid, timestamptz, timestamptz, integer);
--   alter table public.trial_chat_send_reservations rename constraint trial_chat_send_reservations_user_id_fkey to chat_continuation_events_user_id_fkey;
--   alter table public.trial_chat_send_reservations rename constraint trial_chat_send_reservations_pkey to chat_continuation_events_pkey;
--   alter index public.idx_trial_chat_send_reservations_user_created_at rename to idx_chat_continuation_events_user_created_at;
--   alter table public.trial_chat_send_reservations rename to chat_continuation_events;
