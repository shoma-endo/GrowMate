-- Instagram 投稿のエンゲージメント率と、目標判定に使うフォロワー数を追加する。
--
-- 適用時は instagram_media 全行の生成列が計算されるため、ACCESS EXCLUSIVE ロックと
-- テーブル書き換えが発生する。対象行数と停止時間を確認してから適用すること。
-- Rollback:
--   alter table public.instagram_media drop column if exists engagement_rate;
--   alter table public.instagram_credentials drop column if exists followers_count, drop column if exists followers_count_synced_at;

alter table public.instagram_media
  add column engagement_rate numeric generated always as (
    case
      when like_count is not null
        and comments_count is not null
        and saved is not null
        and reach is not null
        and reach > 0
      then (like_count + comments_count + saved)::numeric / reach * 100
      else null
    end
  ) stored;

alter table public.instagram_credentials
  add column followers_count int,
  add column followers_count_synced_at timestamptz;
