-- GA4コンテンツ評価のプロンプトを system / user の2本から1本へ統合する。
-- 他機能（gsc_insight_*）と同じく1テンプレート＝1メッセージ構成に揃え、
-- 評価履歴のプロンプト追跡列（単数形）が実際に使う本文と一致するようにする。
-- 統合前の2件は枠だけ作って本文未登録の状態でのみ削除する（登録済みなら残す）。

insert into public.prompt_templates (name, display_name, content, variables, version)
values
  ('ga4_content_evaluation', 'GA4コンテンツ評価', '', '[{"name":"title","description":"記事タイトル"},{"name":"url","description":"記事URL"},{"name":"char_count","description":"本文文字数"},{"name":"headings","description":"H2見出し"},{"name":"published_at","description":"公開日"},{"name":"updated_at","description":"最終更新日"},{"name":"date_from","description":"計測開始日"},{"name":"date_to","description":"計測終了日"},{"name":"days","description":"計測日数"},{"name":"sessions","description":"訪問した人"},{"name":"engaged_users","description":"読み始めた人"},{"name":"engagement_rate","description":"読み始め率"},{"name":"avg_time_display","description":"実際に読まれた時間"},{"name":"expected_time_display","description":"読み切るのに必要な時間"},{"name":"read_rate","description":"読了率"},{"name":"scroll_users","description":"最後までスクロールした人数"},{"name":"scroll_rate","description":"スクロール率"},{"name":"content_score","description":"コンテンツ力スコア"},{"name":"engage_score","description":"読み始めスコア"},{"name":"read_score","description":"読了スコア"},{"name":"diagnosis_code","description":"診断コード"},{"name":"rank_in_site","description":"サイト内順位"},{"name":"total_articles","description":"評価済み記事数"},{"name":"content_score_diff","description":"コンテンツ力スコアの前回差分"},{"name":"engage_score_diff","description":"読み始めスコアの前回差分"},{"name":"read_score_diff","description":"読了スコアの前回差分"}]'::jsonb, 1)
on conflict (name) do nothing;

-- 本文が未登録のものだけを削除する。誤って本文入りを消さないための保険。
delete from public.prompt_templates
where name in ('ga4_content_evaluation_system', 'ga4_content_evaluation_user')
  and coalesce(btrim(content), '') = '';

-- Rollback: 20260818000400 の insert を再実行し、
--           delete from public.prompt_templates where name = 'ga4_content_evaluation';
