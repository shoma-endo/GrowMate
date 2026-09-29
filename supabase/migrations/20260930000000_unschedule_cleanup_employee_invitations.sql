-- 共有DBに employee_invitations が存在せず cleanup-employee-invitations-ttl が毎日失敗するため削除する。共有DB上は承認済みで unschedule 済み。他環境での再作成防止用。
-- 作成元: supabase/migrations/20251227204537_add_employee_invitations.sql
-- Rollback: なし（再作成しない）

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cleanup-employee-invitations-ttl') then
      perform cron.unschedule('cleanup-employee-invitations-ttl');
    end if;
  end if;
end
$$;
