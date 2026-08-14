-- Instagram サムネイル自前キャッシュ用の列とバケットを追加する。
-- 設計: docs/plans/instagram-media-url-refresh-design.md
--
-- 背景: instagram_media.media_url / thumbnail_url は Instagram CDN の署名付き URL で、
-- 実測で約6日で失効する。既存の同期（incremental/backfill）は一度保存した投稿の URL を
-- 二度と更新しないため、一覧表示のサムネイルが恒久的に壊れる問題があった。
-- 対策として、一覧表示時に自前の Storage バケットへ画像バイトをキャッシュし、
-- 以後は Meta へ再アクセスせず自前ストレージから配信する。
--
-- ロールバック:
--   delete from storage.buckets where id = 'instagram-media-thumbnails';
--   alter table public.instagram_media drop column cached_thumbnail_path;

alter table public.instagram_media
  add column cached_thumbnail_path text;

comment on column public.instagram_media.cached_thumbnail_path is
  'Supabase Storage (instagram-media-thumbnails バケット) 上のキャッシュ済みサムネイル画像のパス（{user_id}/{ig_media_id}.jpg）。NULL は未キャッシュ。Meta の media_url/thumbnail_url は署名付きURLで失効するため、表示は本列経由の自前キャッシュを正とする（app/api/instagram/media/[igMediaId]/thumbnail 参照）';

-- 非公開バケット。クライアント・anon/authenticated キーからの直接アクセスは行わず、
-- 常に Service Role（Route Handler 経由）でのみアクセスする設計のため、
-- storage.objects への RLS ポリシーは追加しない（Service Role は RLS をバイパスする）。
insert into storage.buckets (id, name, public)
values ('instagram-media-thumbnails', 'instagram-media-thumbnails', false)
on conflict (id) do nothing;
