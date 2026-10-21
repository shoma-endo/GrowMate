-- 予約の件数に加えて、当日の user メッセージの件数も数え、多い方で上限を判定する。
-- 予約より前に保存された送信（予約を始めた日の分）を取りこぼさないため。予約後の送信は予約と user メッセージの
-- 両方に残るが、多い方を取るので二重には数えない（続き生成は予約だけ、失敗した生成は予約だけが残る）。
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
  v_messages integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  -- 同じユーザーの予約だけを直列にする（トランザクションの終わりで外れる）
  perform pg_advisory_xact_lock(hashtextextended('reserve_trial_chat_send:' || p_user_id::text, 0));

  select count(*) into v_reserved
    from public.trial_chat_send_reservations
   where user_id = p_user_id
     and created_at >= p_from
     and created_at < p_to;

  select count(*) into v_messages
    from public.chat_messages
   where user_id = p_user_id::text
     and role = 'user'
     and created_at >= p_from
     and created_at < p_to;

  if greatest(v_reserved, v_messages) >= p_limit then
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

-- Rollback: 20261022000000_reserve_trial_chat_sends.sql の関数定義をもう一度流す（予約の件数だけで数える版に戻る）
