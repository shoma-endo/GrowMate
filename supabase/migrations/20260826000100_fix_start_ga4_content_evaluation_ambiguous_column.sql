-- start_ga4_content_evaluation のリース期限切れ回復パスが必ず実行時エラーになる不具合を修正する。
--
-- 症状: 評価が途中で死ぬ（route.ts の maxDuration=300秒 超過・デプロイ・プロセスクラッシュ）と
-- ga4_content_evaluations.status='evaluating' が残る。以後その記事に対する start は毎回
--   ERROR: column reference "evaluation_run_id" is ambiguous
-- で中断し、15分リースによる自動回復が一度も動かない。cancelRun() は自分が発行した runId を
-- 引数に取るため孤児化したリースを解除できず、アプリ側に復旧経路が無い（本番DBへの直接SQLが必要）。
-- 毎時 Cron もその記事で毎回失敗し続ける。
--
-- 原因: returns table(evaluation_run_id uuid) の OUT パラメータが同名の PL/pgSQL 変数を
-- 関数スコープへ導入する。ga4_content_evaluation_history にも evaluation_run_id 列が実在する
-- （20260818000100:21）ため、裸の参照は variable_conflict の既定値 error で衝突する。
-- パース時ではなく実行時に落ちるので、この分岐を通らない限り露見しない。
--
-- 修正: UPDATE 対象にエイリアス h を付けて列を修飾する。
-- returns table(...) の名前は変えない。変えると PostgREST の戻り値キー名が変わり、
-- ga4ContentEvaluationService.ts:537 の data?.[0]?.evaluation_run_id も直す必要が出るため、
-- 影響がこのファイルに閉じるエイリアス方式を採る。
--
-- 同じ欠陥は 20260818000200 / 20260819000200 / 20260825000000 / 20260825000100 の4版すべてに
-- あるが、それらは適用済みのため書き換えない（書き換えても本番には効かず履歴だけ食い違う）。
-- 本番に効くのは最後に適用されたこの定義だけである。
--
-- データ移行は不要: 修正後は回復パスが動くため、固着した行は次の start 呼び出しで自動復旧する。
-- あわせて 20260825000000 が導入した error_code='evaluation_run_expired' が初めて実際に
-- 書かれるようになる（それまでこの行は到達不能で、src/lib/ga4-evaluation-display.ts:42 の
-- ラベルと src/types/ga4-evaluation.ts の union メンバーはデッドコードだった）。
--
-- 関数本体は 20260825000100 の定義をそのまま踏襲し、上記の1行だけを変えている。

create or replace function public.start_ga4_content_evaluation(
  p_user_id uuid,
  p_content_annotation_id uuid
)
returns table(evaluation_run_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  evaluation_row public.ga4_content_evaluations%rowtype;
  run_id uuid := gen_random_uuid();
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;
  if not exists (
    select 1 from public.content_annotations
    where id = p_content_annotation_id and user_id = p_user_id::text
  ) then
    raise exception 'content annotation owner mismatch';
  end if;

  select * into evaluation_row
  from public.ga4_content_evaluations
  where user_id = p_user_id and content_annotation_id = p_content_annotation_id
  for update;

  if evaluation_row.id is null then
    insert into public.ga4_content_evaluations (user_id, content_annotation_id, status, active_run_id, evaluation_started_at, lease_expires_at)
    values (p_user_id, p_content_annotation_id, 'evaluating', run_id, timezone('utc', now()), timezone('utc', now()) + interval '15 minutes')
    on conflict (user_id, content_annotation_id) do nothing;
    select * into evaluation_row
    from public.ga4_content_evaluations
    where user_id = p_user_id and content_annotation_id = p_content_annotation_id
    for update;
  end if;

  if evaluation_row.id is not null and evaluation_row.status = 'evaluating'
    and (evaluation_row.active_run_id is null or evaluation_row.active_run_id <> run_id) then
    if evaluation_row.evaluation_started_at is not null
      and evaluation_row.evaluation_started_at > timezone('utc', now()) - interval '15 minutes' then
      raise exception 'ga4 evaluation already running';
    end if;
    -- 修正箇所: エイリアス h で列を修飾し、OUT パラメータ evaluation_run_id との衝突を避ける
    update public.ga4_content_evaluation_history h
      set status = 'evaluation_failed', completed_at = timezone('utc', now()),
          error_code = 'evaluation_run_expired', error_message = '評価実行が期限切れになりました'
      where h.evaluation_run_id = evaluation_row.active_run_id and h.status = 'evaluating';
  end if;

  if evaluation_row.id is not null then
    update public.ga4_content_evaluations
      set status = 'evaluating', active_run_id = run_id,
          evaluation_started_at = timezone('utc', now()), lease_expires_at = timezone('utc', now()) + interval '15 minutes',
          last_error_code = null, last_error_message = null
      where id = evaluation_row.id;
  end if;

  insert into public.ga4_content_evaluation_history (evaluation_run_id, user_id, content_annotation_id, status)
  values (run_id, p_user_id, p_content_annotation_id, 'evaluating');
  return query select run_id;
end;
$$;

revoke execute on function public.start_ga4_content_evaluation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_ga4_content_evaluation(uuid, uuid) to service_role;

-- 検証SQL（ローカルで実行して回復を確認する。本番では実行しない）:
--   select * from start_ga4_content_evaluation('<uid>','<ann>');
--   update ga4_content_evaluations set evaluation_started_at = now() - interval '20 minutes'
--     where user_id = '<uid>' and content_annotation_id = '<ann>';
--   select * from start_ga4_content_evaluation('<uid>','<ann>');  -- 新しい run_id が返ればOK
--   select status, error_code from ga4_content_evaluation_history where content_annotation_id = '<ann>';
--     -- 古い行が evaluation_failed / evaluation_run_expired になっていることを確認する
--
-- Rollback: 20260825000100_remove_ga4_content_evaluation_prompt_audit_columns.sql の
-- start_ga4_content_evaluation 定義を再適用する。ただし戻すと上記の固着が再発する。
