-- 評価履歴ごとのメモ

alter table public.gsc_article_evaluation_history
  add column memo text null;

comment on column public.gsc_article_evaluation_history.memo is '評価履歴ごとのメモ';

-- Rollback instructions:
-- alter table public.gsc_article_evaluation_history
--   drop column memo;
-- メモを削除して元に戻せないため、通常はアプリケーションのロールバック後もカラムを残す。
