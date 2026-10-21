-- 開発初期の全許可ポリシー（FOR ALL USING (true)、対象ロール public）が本番に残っていた。
-- RLS のポリシーは OR で効くため、*_own ポリシーがあっても anon キーだけで全行を読み書きできる状態だった。
-- アプリのテーブルアクセスはすべて Service Role（RLS をバイパス）なので、外してもアプリの動作は変わらない。
drop policy if exists "開発環境用全許可ポリシー_users" on public.users;
drop policy if exists "開発環境用全許可ポリシー_briefs" on public.briefs;
drop policy if exists "開発環境用全許可ポリシー_chat_sessions" on public.chat_sessions;
drop policy if exists "開発環境用全許可ポリシー_chat_messages" on public.chat_messages;

-- 想定どおりになったかを確かめる（想定外なら適用を失敗させる）
do $$
declare
  v_remaining text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
    into v_remaining
    from pg_policies
   where schemaname = 'public'
     and (qual = 'true' or with_check = 'true');
  if v_remaining is not null then
    raise exception 'public スキーマに全許可ポリシーが残っている: %', v_remaining;
  end if;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('users', 'briefs', 'chat_sessions', 'chat_messages')
       and not c.relrowsecurity
  ) then
    raise exception 'users / briefs / chat_sessions / chat_messages のどれかで RLS が無効になっている';
  end if;
end $$;

-- Rollback（anon キーで全行が読み書きできる状態に戻る。戻す理由が無い限り使わない）:
--   create policy "開発環境用全許可ポリシー_users" on public.users for all using (true);
--   create policy "開発環境用全許可ポリシー_briefs" on public.briefs for all using (true);
--   create policy "開発環境用全許可ポリシー_chat_sessions" on public.chat_sessions for all using (true);
--   create policy "開発環境用全許可ポリシー_chat_messages" on public.chat_messages for all using (true);
