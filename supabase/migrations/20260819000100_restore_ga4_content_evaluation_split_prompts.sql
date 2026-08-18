-- 20260819000000 の統合を取り消し、system / user の2テンプレート構成へ戻す。
-- 取り消しの理由: llmService は先頭の role='system' を Anthropic の top-level
-- `system` パラメータへ分離して送る（llmService.ts:36-41, :145）。1本へ統合すると
-- `system` が消え、出力契約（前置きなし5フィールドJSON）の指示位置と
-- cache_control: ephemeral の経路が失われるため。
-- 3件とも本文未登録の状態でのみ入れ替える（登録済みなら残す）。

insert into public.prompt_templates (name, display_name, content, variables, version)
values
  ('ga4_content_evaluation_system', 'GA4コンテンツ評価（システム）', '', '[]'::jsonb, 1),
  ('ga4_content_evaluation_user', 'GA4コンテンツ評価（ユーザー）', '', '[{"name":"title","description":"記事タイトル"},{"name":"url","description":"記事URL"},{"name":"char_count","description":"本文文字数"},{"name":"headings","description":"H2見出し"},{"name":"published_at","description":"公開日"},{"name":"updated_at","description":"最終更新日"},{"name":"date_from","description":"計測開始日"},{"name":"date_to","description":"計測終了日"},{"name":"days","description":"計測日数"},{"name":"sessions","description":"訪問した人"},{"name":"engaged_users","description":"読み始めた人"},{"name":"engagement_rate","description":"読み始め率"},{"name":"avg_time_display","description":"実際に読まれた時間"},{"name":"expected_time_display","description":"読み切るのに必要な時間"},{"name":"read_rate","description":"読了率"},{"name":"scroll_users","description":"最後までスクロールした人数"},{"name":"scroll_rate","description":"スクロール率"},{"name":"content_score","description":"コンテンツ力スコア"},{"name":"engage_score","description":"読み始めスコア"},{"name":"read_score","description":"読了スコア"},{"name":"diagnosis_code","description":"診断コード"},{"name":"rank_in_site","description":"サイト内順位"},{"name":"total_articles","description":"評価済み記事数"},{"name":"content_score_diff","description":"コンテンツ力スコアの前回差分"},{"name":"engage_score_diff","description":"読み始めスコアの前回差分"},{"name":"read_score_diff","description":"読了スコアの前回差分"}]'::jsonb, 1)
on conflict (name) do nothing;

delete from public.prompt_templates
where name = 'ga4_content_evaluation'
  and coalesce(btrim(content), '') = '';

-- Rollback: 20260819000000 を再実行する。
