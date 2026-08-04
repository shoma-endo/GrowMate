-- 除外キーワード提案バッチの「同日 1 回だけ試行」を担保するための試行日カラム。
--
-- 背景: 抽出条件を `send_hour_jst = 現在時刻` から `<=` に緩和し、時間予算切れで取りこぼした
-- ユーザーを同日中の後続毎時 cron で回収できるようにした。ただし `last_sent_on` は成功時のみ
-- 更新されるため、恒久的に失敗するユーザー（Google Ads 未接続・メール送信失敗など）が
-- 毎時リトライされ続ける副作用がある。試行日を別カラムで持つことでこれを 1 日 1 回に制限する。
--
-- last_sent_on      : 送信成功時のみ更新（UI の「最終送信日」表示に使う）
-- last_attempted_on : 成功・失敗を問わず試行した時点で更新（cron の同日重複実行を防ぐ）
-- 時間予算で未着手のまま残ったユーザーは両方とも未更新のため、次の毎時 cron が回収する。
--
-- Rollback:
--   alter table public.google_ads_negative_keywords_settings drop column if exists last_attempted_on;

alter table public.google_ads_negative_keywords_settings
  add column if not exists last_attempted_on date;

comment on column public.google_ads_negative_keywords_settings.last_attempted_on is
  '直近の配信試行日（JST）。成功・失敗を問わず cron が試行した時点で更新し、同日の重複実行を防ぐ。';
