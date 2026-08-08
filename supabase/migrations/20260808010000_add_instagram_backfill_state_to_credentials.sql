-- Instagram 過去投稿取り込み（backfill）用の状態カラムを instagram_credentials に追加
--
-- Rollback:
--   alter table public.instagram_credentials drop column if exists backfill_cursor;
--   alter table public.instagram_credentials drop column if exists backfill_completed_at;

alter table public.instagram_credentials
  add column backfill_cursor text,
  add column backfill_completed_at timestamptz;

comment on column public.instagram_credentials.backfill_cursor is
  'Instagram Graph API /me/media のページングカーソル（過去の投稿取り込みの再開位置）。NULL は未着手または直近リセット済み';
comment on column public.instagram_credentials.backfill_completed_at is
  'アカウントの投稿履歴を最後まで取り込み終えた日時。NULL は未完了（進行中 or 未着手）';
