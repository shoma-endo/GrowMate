-- AI要約一括実行のバックグラウンド化（docs/plans/content-annotation-bulk-summary-background-spec.md §9）
--
-- 起票された1ジョブ = 対象記事IDの配列。cron が claim して配列順にチャンク（最大3件）で処理し、
-- チャンク境界でカーソル（processed_count）と件数を書き戻す（BR-B09）。
--
-- 雛形は gsc_suggestion_jobs（20260611000000_add_gsc_suggestion_jobs.sql）。
-- **attempt_count の意味だけ読み替える**: 雛形は「claim の総回数」だが、本テーブルは
-- 「前進の無い claim が連続した回数」。本仕様のジョブは設計上、複数回の cron 起動にまたがって
-- 同じ行を claim し直すため（BR-B04 例外）、総回数で数えると267件（約4起動）のジョブが
-- 1件も残していないのに failed に落ちる（§4 Non-goals）。
-- 加算は本ファイルの RPC が行い、**0 へのリセットはアプリ層の進捗保存が行う**（BR-B09）。

create table if not exists public.content_annotation_summary_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  -- claim 時に発行する実行トークン。進捗更新の条件に付け、別起動に回収済みのジョブへ
  -- 書き込まないようにする（BR-B09）。雛形の suggestion_job_token と同型
  job_token uuid,
  -- 起票時に解決した対象（BR-B02）。cron はこの配列順で処理し、実行時に並べ替えない
  target_annotation_ids uuid[] not null,
  -- 起票時に固定した対象ID数。「要約される見込み件数」ではない（§6 分母の定義）
  total_count integer not null check (total_count >= 0),
  -- 処理済み位置（target_annotation_ids の配列 index を指すカーソル兼用）。
  -- 完了したチャンクの末尾までしか進めない（BR-B09）
  processed_count integer not null default 0 check (processed_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_by_code jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  -- 通知の試行を終えた時刻（送信成功時 + 宛先が無く送れなかった時。送信失敗時は埋めない）。
  -- BR-B06 の冪等と、掃き出しの対象判定に使う
  notified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz
);

-- claim の走査用（§9 インデックス）
create index if not exists idx_content_annotation_summary_jobs_claim
  on public.content_annotation_summary_jobs (status, created_at)
  where status in ('pending', 'processing');

-- BR-B03「同時に走るジョブは1利用者につき1件」を DB 側でも担保する。
-- 事前 SELECT だけだと同時2クリックで二重起票を通してしまう
create unique index if not exists uq_content_annotation_summary_jobs_active_user
  on public.content_annotation_summary_jobs (user_id)
  where status in ('pending', 'processing');

-- RLS は多層防御。実際のセキュリティ境界はアプリ層の `.eq('user_id', userId)` スコープ
-- （.agents/skills/supabase/service-usage.md §3）。書き込みは Service Role のみ（RLS をバイパスする）
alter table public.content_annotation_summary_jobs enable row level security;

drop policy if exists "content_annotation_summary_jobs_select_own"
  on public.content_annotation_summary_jobs;
create policy "content_annotation_summary_jobs_select_own"
  on public.content_annotation_summary_jobs
  for select
  using ((select auth.uid()) = user_id);

-- 同名関数のオーバーロードを全 oid 走査で drop してから作り直す。
-- **引数リストを列挙する `drop function if exists` は使わない**:
-- 20260831010000 の事故（リポジトリに定義が無い版がリモートに残り、PostgREST が
-- 呼び出し先を一意に決められなくなった）と同じ取りこぼしが起きるため。
-- 「migration 履歴＝リモートの現状」と仮定しない。
do $$
declare
  fn record;
begin
  for fn in
    select p.oid, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_content_annotation_summary_jobs'
  loop
    raise notice 'dropping existing overload: claim_content_annotation_summary_jobs(%)', fn.args;
    execute format('drop function public.claim_content_annotation_summary_jobs(%s)', fn.args);
  end loop;
end $$;

create function public.claim_content_annotation_summary_jobs(p_limit integer default 1)
returns table (
  id uuid,
  user_id uuid,
  target_annotation_ids uuid[],
  total_count integer,
  processed_count integer,
  succeeded_count integer,
  failed_count integer,
  skipped_count integer,
  failed_by_code jsonb,
  attempt_count integer,
  job_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 10 then
    raise exception 'p_limit must be between 1 and 10';
  end if;

  -- 前進の無い claim が3回連続した行は claim せず failed に落とす（雛形と同値の `>= 3`）。
  -- この経路で failed になった行は下の `return query` で返さないため、アプリ層は一度も見ない。
  -- 完了メールは cron ルートの掃き出しが送る（AC-B15 / §9 完了メールの起動経路）。
  update public.content_annotation_summary_jobs as job
  set
    status = 'failed',
    last_error = coalesce(job.last_error, 'AI要約ジョブが前進しないまま中断しました'),
    finished_at = timezone('utc', now())
  where job.attempt_count >= 3
    and (
      job.status = 'pending'
      or (
        job.status = 'processing'
        -- 20分。雛形は15分だが、本仕様の route は maxDuration 800秒（13.3分）なので
        -- 15分のままだと余裕が1.7分しかなく、稼働中のジョブを「スタック」と誤判定して
        -- 二重に claim し、同じ記事へ二重課金・件数の二重加算が起きる（§8）
        and job.started_at <= timezone('utc', now()) - interval '20 minutes'
      )
    );

  return query
  with candidate as (
    select job.id
    from public.content_annotation_summary_jobs as job
    where job.attempt_count < 3
      and (
        job.status = 'pending'
        or (
          job.status = 'processing'
          and job.started_at <= timezone('utc', now()) - interval '20 minutes'
        )
      )
    order by job.created_at
    for update skip locked
    limit p_limit
  )
  update public.content_annotation_summary_jobs as job
  set
    status = 'processing',
    -- 加算だけを行う。「前進があったか」は RPC からは分からないので、
    -- 0 へのリセットはアプリ層の進捗保存に任せる（BR-B09）
    attempt_count = job.attempt_count + 1,
    started_at = timezone('utc', now()),
    last_error = null,
    job_token = gen_random_uuid()
  from candidate
  where job.id = candidate.id
  returning
    job.id,
    job.user_id,
    job.target_annotation_ids,
    job.total_count,
    job.processed_count,
    job.succeeded_count,
    job.failed_count,
    job.skipped_count,
    job.failed_by_code,
    job.attempt_count,
    job.job_token;
end;
$$;

revoke all on function public.claim_content_annotation_summary_jobs(integer) from public;
revoke all on function public.claim_content_annotation_summary_jobs(integer) from anon;
revoke all on function public.claim_content_annotation_summary_jobs(integer) from authenticated;
grant execute on function public.claim_content_annotation_summary_jobs(integer) to service_role;

-- 権限が意図どおりであることを適用時に検査する（20260831010000 の前例）。
-- 想定外なら適用を失敗させ、anon から叩ける状態で本番へ出さない
do $$
declare
  fn_count integer;
  fn_oid oid;
begin
  select count(*) into fn_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_content_annotation_summary_jobs';

  if fn_count <> 1 then
    raise exception 'claim_content_annotation_summary_jobs は1本だけ残るはずが % 本ある', fn_count;
  end if;

  select p.oid into fn_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_content_annotation_summary_jobs';

  if not has_function_privilege('service_role', fn_oid, 'execute') then
    raise exception 'service_role が claim_content_annotation_summary_jobs を実行できない';
  end if;
  if has_function_privilege('anon', fn_oid, 'execute') then
    raise exception 'anon が claim_content_annotation_summary_jobs を実行できてしまう（revoke 漏れ）';
  end if;
  if has_function_privilege('authenticated', fn_oid, 'execute') then
    raise exception 'authenticated が claim_content_annotation_summary_jobs を実行できてしまう（revoke 漏れ）';
  end if;
end $$;

-- Rollback:
-- do $$
-- declare fn record;
-- begin
--   for fn in
--     select p.oid, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'claim_content_annotation_summary_jobs'
--   loop
--     execute format('drop function public.claim_content_annotation_summary_jobs(%s)', fn.args);
--   end loop;
-- end $$;
-- drop table if exists public.content_annotation_summary_jobs;
