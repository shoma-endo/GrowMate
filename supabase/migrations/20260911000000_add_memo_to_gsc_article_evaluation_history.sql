-- 評価履歴ごとのメモ

alter table public.gsc_article_evaluation_history
  add column memo text null;

comment on column public.gsc_article_evaluation_history.memo is '評価履歴ごとのメモ';

-- このテーブルへの書き込みは全てService Roleクライアント経由（RLSバイパス）で行われるため、
-- authenticated ロールに書き込みを許可する必要がない。
-- 残っていると trial / unavailable のユーザーが PostgREST を直接呼んで
-- 自分の行の memo などを更新でき、Server Action の canWriteGa4 判定を迂回できるため削除する。
-- 参照系は gsc_article_evaluation_history_select_own_or_owner（20260107000002）が担う。
drop policy if exists "gsc_article_eval_history_mutate_own"
  on public.gsc_article_evaluation_history;

-- Rollback instructions:
-- alter table public.gsc_article_evaluation_history
--   drop column memo;
-- メモを削除して元に戻せないため、通常はアプリケーションのロールバック後もカラムを残す。
--
-- create policy "gsc_article_eval_history_mutate_own"
--   on public.gsc_article_evaluation_history
--   for all
--   using ((select auth.uid()) = user_id)
--   with check ((select auth.uid()) = user_id);
