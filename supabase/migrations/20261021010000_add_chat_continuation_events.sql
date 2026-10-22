-- 続き生成は user メッセージを保存しない（途切れた assistant メッセージを上書きする）ため、
-- trial の1日の送信回数に数えるための記録をここに残す。
create table public.chat_continuation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_chat_continuation_events_user_created_at
  on public.chat_continuation_events (user_id, created_at);

-- アクセスは Service Role だけ（RLS をバイパス）。anon / authenticated には何も許さない。
alter table public.chat_continuation_events enable row level security;
revoke all on table public.chat_continuation_events from public, anon, authenticated;
grant select, insert on table public.chat_continuation_events to service_role;

-- 想定どおりの権限になったかを確かめる（想定外なら適用を失敗させる）
do $$
declare
  tbl_oid oid := 'public.chat_continuation_events'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = tbl_oid) then
    raise exception 'chat_continuation_events の RLS が無効になっている';
  end if;
  if has_table_privilege('anon', tbl_oid, 'select') or has_table_privilege('anon', tbl_oid, 'insert') then
    raise exception 'anon が chat_continuation_events を読み書きできてしまう（revoke 漏れ）';
  end if;
  if has_table_privilege('authenticated', tbl_oid, 'select') or has_table_privilege('authenticated', tbl_oid, 'insert') then
    raise exception 'authenticated が chat_continuation_events を読み書きできてしまう（revoke 漏れ）';
  end if;
  if not has_table_privilege('service_role', tbl_oid, 'insert') then
    raise exception 'service_role が chat_continuation_events に書き込めない';
  end if;
end $$;

-- Rollback:
--   drop table public.chat_continuation_events;
