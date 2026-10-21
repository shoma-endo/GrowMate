-- 当日の送信回数 = 予約の件数 + その日の最初の予約より前の user メッセージの件数。
-- 予約を始める前（反映前）の送信は user メッセージにしか残らず、予約を始めた後の送信は予約で数えるので、
-- 最初の予約の時刻で分ければ二重にも取りこぼしにもならない。予約がまだ無い日は当日の user メッセージをすべて数える。
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
  v_reserved integer;
  v_first_reserved_at timestamptz;
  v_messages_before_reservation integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  -- 同じユーザーの予約だけを直列にする（トランザクションの終わりで外れる）
  perform pg_advisory_xact_lock(hashtextextended('reserve_trial_chat_send:' || p_user_id::text, 0));

  select count(*), min(created_at) into v_reserved, v_first_reserved_at
    from public.trial_chat_send_reservations
   where user_id = p_user_id
     and created_at >= p_from
     and created_at < p_to;

  select count(*) into v_messages_before_reservation
    from public.chat_messages
   where user_id = p_user_id::text
     and role = 'user'
     and created_at >= p_from
     and created_at < coalesce(v_first_reserved_at, p_to);

  if v_reserved + v_messages_before_reservation >= p_limit then
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
begin
  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が reserve_trial_chat_send を実行できない';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') or has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'anon / authenticated が reserve_trial_chat_send を実行できてしまう（revoke 漏れ）';
  end if;
end $$;

-- Rollback: 20261022010000_count_existing_messages_in_trial_reservation.sql の関数定義をもう一度流す
