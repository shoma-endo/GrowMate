-- users.google_search_count 列が廃止済みで、reset-google-search-count（毎月1日 00:00 UTC = 9:00 JST の `UPDATE users SET google_search_count = 0;`）が毎月失敗するため削除する。共有DB上は承認済みで unschedule 済み。他環境での再作成防止用。
-- 作成元: supabase/migrations/20250619000000_add_google_search_count.sql（履歴は書き換えない）
-- Rollback: なし（再作成しない）

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'reset-google-search-count') then
      perform cron.unschedule('reset-google-search-count');
    end if;
  end if;
end
$$;
