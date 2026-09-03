-- 復旧: 一覧 RPC のオーバーロード衝突を解消する。
--
-- 事象: 20260831000000（未要約フィルタ追加）を適用した直後から /analytics の一覧が
-- 「Could not choose the best candidate function between: ...」で全滅した。
--
-- 原因: リモートには `p_ga4_content_score_below integer` を持つ版が存在していたが、
-- **この関数を作る migration はリポジトリに1つも無い**（`08232bd4 feat(ga4): D11のコンテンツ力スコア閾値フィルタを削除` で
-- migration ファイルだけがリポジトリから消え、リモートの関数が残ったもの）。20260831000000 の `drop function if exists` は boolean だけの引数リストを
-- 列挙していたため、integer を含むこの版だけが drop されずに残り、
--   (uuid, int, int, text[], bool, bool, bool, bool, integer)  ← 孤児
--   (uuid, int, int, text[], bool, bool, bool, bool, boolean)  ← 未要約フィルタ版
-- の同アリティ2本になった。PostgREST は名前付き引数から呼び出し先を一意に決められない。
--
-- 対処: 孤児の方だけを drop する。この関数を呼ぶコードはリポジトリに存在しない
-- （`p_ga4_content_score_below` の grep ヒットは生成型 database.types.ts のみ）。
--
-- 再発防止: 今後この関数のシグネチャを変える migration では、`drop function if exists` に
-- 引数リストを列挙するのではなく、下と同じ「同名関数を全 oid 走査して drop」を使うこと。
-- 列挙方式は「リポジトリに無いがリモートにはある」版を取りこぼす。
do $$
declare
  fn record;
begin
  for fn in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_filtered_content_annotations'
      -- 残すのは未要約フィルタ版だけ
      and not exists (
        select 1
        from unnest(p.proargnames) as arg_name
        where arg_name = 'p_has_unsummarized'
      )
  loop
    raise notice 'dropping orphan overload: get_filtered_content_annotations(%)', fn.args;
    execute format('drop function public.get_filtered_content_annotations(%s)', fn.args);
  end loop;
end $$;

-- 残った1本が想定どおりであることを確認する（想定外なら適用を失敗させる）
do $$
declare
  fn_count integer;
  fn_oid oid;
begin
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_filtered_content_annotations';

  if fn_count <> 1 then
    raise exception 'get_filtered_content_annotations は1本だけ残るはずが % 本ある', fn_count
      using detail = coalesce((
        select string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_filtered_content_annotations'
      ), '(なし)');
  end if;

  select p.oid into fn_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_filtered_content_annotations';

  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が get_filtered_content_annotations を実行できない';
  end if;

  -- 逆向きも見る。孤児は SQL エディタで手作りされた疑いが濃く、その場合 PUBLIC に既定の
  -- EXECUTE が付いたまま anon から叩けていた可能性がある。同じ事故を次に検出できるようにする
  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'anon が get_filtered_content_annotations を実行できてしまう（revoke 漏れ）';
  end if;
end $$;

-- Rollback: 孤児版はリポジトリに定義が無いため復元できない。
-- 呼び出し元も存在しないので復元の必要も無い。
