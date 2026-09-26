-- Instagram 投稿一覧の率の列（いいね率・保存率・シェア率・コメント率・再投稿率）を生成列にする。
--
-- これまでは画面側で「分子 ÷ リーチ × 100」を計算して表示しており、DB で並べ替えられなかった
-- （一覧は1ページ10件のサーバーページングのため、画面側で並べ替えると表示中の10件だけが並び替わる）。
-- 式と null の扱いは engagement_rate（20260921000000）と同じ: 分子・リーチのどちらかが null、
-- またはリーチが 0 以下なら null。値は丸めない（表示側で小数第1位にする）。
--
-- 適用時は instagram_media 全行の生成列が計算されるため、ACCESS EXCLUSIVE ロックと
-- テーブル書き換えが発生する。対象行数と停止時間を確認してから適用すること。
-- **アプリのデプロイより先に適用すること。** 未適用の DB に対して率の列で並べ替えると、
-- 存在しない列を ORDER BY してクエリが失敗する。
-- Rollback:
--   alter table public.instagram_media
--     drop column if exists like_rate,
--     drop column if exists saved_rate,
--     drop column if exists share_rate,
--     drop column if exists comment_rate,
--     drop column if exists repost_rate;

alter table public.instagram_media
  add column like_rate numeric generated always as (
    case when like_count is not null and reach is not null and reach > 0
      then like_count::numeric / reach * 100 else null end
  ) stored,
  add column saved_rate numeric generated always as (
    case when saved is not null and reach is not null and reach > 0
      then saved::numeric / reach * 100 else null end
  ) stored,
  add column share_rate numeric generated always as (
    case when shares is not null and reach is not null and reach > 0
      then shares::numeric / reach * 100 else null end
  ) stored,
  add column comment_rate numeric generated always as (
    case when comments_count is not null and reach is not null and reach > 0
      then comments_count::numeric / reach * 100 else null end
  ) stored,
  add column repost_rate numeric generated always as (
    case when reposts is not null and reach is not null and reach > 0
      then reposts::numeric / reach * 100 else null end
  ) stored;
