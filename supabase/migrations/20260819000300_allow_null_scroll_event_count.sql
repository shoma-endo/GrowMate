-- 90%スクロールイベントが GA4 プロパティに存在しない場合を「実測0回」と区別できるようにする。
--
-- これまで scroll_90_event_count は not null default 0 だったため、対象イベントが
-- プロパティに1つも存在しないプロパティでも全行に 0 が入り、評価側は「実測して0%だった」と
-- 解釈していた。その結果、読了スコア40未満の記事が、計測していない完読率を根拠に
-- 診断コード R_TOP_EXIT（冒頭離脱型）へ強制上書きされ、LLM へも
-- 「実測なし。1人あたり平均で全体の0%まで読まれています」という矛盾した文言が渡っていた。
-- 欠損を0と区別する（BR-02）ため NULL を許可する。
alter table public.ga4_page_metrics_daily
  alter column scroll_90_event_count drop not null,
  alter column scroll_90_event_count drop default;

comment on column public.ga4_page_metrics_daily.scroll_90_event_count is
  '90%スクロールイベントの発生数。NULL は「対象イベントがプロパティに存在せず未計測」を表し、0（実測して0回）とは区別する（BR-02）';

-- 既存の 0 は「未計測」と「実測0」を判別できない。残すと、再取込までのあいだ
-- 「旧コードが書いた偽の0」と「新コードが書いた実測値」が同じ90日の評価窓に混在し、
-- NULL が1件も無いため未計測判定が働かないまま、分子だけが薄まった完読率が出る。
-- それは `scrollRate < 0.15 かつ readScore < 40` の R_TOP_EXIT 帯にそのまま落ちるため、
-- 「実測なし」に倒れる旧状態よりも検知しにくい誤診断になる。
-- 判別できない値は未計測と宣言する（BR-02）。正の値は確実に実測なので温存する。
update public.ga4_page_metrics_daily
  set scroll_90_event_count = null
  where scroll_90_event_count = 0;

-- 実測値は再取込（/ga4-dashboard の「過去90日を再取込」）で復元される。
-- イベントが存在しないプロパティでは NULL のまま、存在するプロパティでは実測値になる。

-- Rollback:
-- update public.ga4_page_metrics_daily set scroll_90_event_count = 0 where scroll_90_event_count is null;
-- alter table public.ga4_page_metrics_daily
--   alter column scroll_90_event_count set default 0,
--   alter column scroll_90_event_count set not null;
