-- Supabase advisor（security）の指摘対応: anon / authenticated から実行できる SECURITY DEFINER 関数を閉じ、
-- search_path 未設定の関数に search_path を固定する。
--
-- get_database_size / get_table_sizes: 呼び出し元は scripts/check-db-stats.ts（SUPABASE_SERVICE_ROLE）だけ。
-- increment_google_search_count: 呼び出し元なし。users.google_search_count 列が廃止済みのため今は実行時に失敗するが、
--   列が戻れば任意ユーザーの行を更新できる関数なので anon / authenticated から閉じる。
-- validate_ga4_content_evaluation_owner: トリガー専用で、search_path = public は作成時から設定済み。
--   トリガー発火時は EXECUTE 権限を見ない（CREATE TRIGGER 時だけ見る）ため、直接実行の権限を外してもトリガーは動く。
--
-- Supabase は public の新規関数に anon / authenticated へ明示 grant を付けるため、PUBLIC だけでなく両ロールからも revoke する。

alter function public.get_database_size() set search_path = public;
alter function public.get_table_sizes(text[]) set search_path = public;
alter function public.increment_google_search_count(uuid) set search_path = public;

revoke execute on function public.get_database_size() from public, anon, authenticated;
revoke execute on function public.get_table_sizes(text[]) from public, anon, authenticated;
revoke execute on function public.increment_google_search_count(uuid) from public, anon, authenticated;
revoke execute on function public.validate_ga4_content_evaluation_owner() from public, anon, authenticated;

grant execute on function public.get_database_size() to service_role;
grant execute on function public.get_table_sizes(text[]) to service_role;
grant execute on function public.increment_google_search_count(uuid) to service_role;
grant execute on function public.validate_ga4_content_evaluation_owner() to service_role;

-- 想定どおりの権限と search_path になったかを確かめる（想定外なら適用を失敗させる）
do $$
declare
  fn text;
  fn_oid oid;
begin
  foreach fn in array array[
    'public.get_database_size()',
    'public.get_table_sizes(text[])',
    'public.increment_google_search_count(uuid)',
    'public.validate_ga4_content_evaluation_owner()'
  ] loop
    fn_oid := fn::regprocedure;
    if not has_function_privilege('service_role', fn_oid, 'execute') then
      raise exception 'service_role が % を実行できない', fn;
    end if;
    if has_function_privilege('anon', fn_oid, 'execute') then
      raise exception 'anon が % を実行できてしまう（revoke 漏れ）', fn;
    end if;
    if has_function_privilege('authenticated', fn_oid, 'execute') then
      raise exception 'authenticated が % を実行できてしまう（revoke 漏れ）', fn;
    end if;
    if not exists (
      select 1 from pg_proc p, unnest(p.proconfig) as cfg
      where p.oid = fn_oid and cfg = 'search_path=public'
    ) then
      raise exception '% の search_path が public になっていない', fn;
    end if;
  end loop;
end $$;

-- Rollback（advisor の指摘が戻る。元の状態に戻す必要があるときだけ）:
--   alter function public.get_database_size() reset search_path;
--   alter function public.get_table_sizes(text[]) reset search_path;
--   alter function public.increment_google_search_count(uuid) reset search_path;
--   grant execute on function public.get_database_size() to public, anon, authenticated;
--   grant execute on function public.get_table_sizes(text[]) to public, anon, authenticated;
--   grant execute on function public.increment_google_search_count(uuid) to public, anon, authenticated;
--   grant execute on function public.validate_ga4_content_evaluation_owner() to public, anon, authenticated;
