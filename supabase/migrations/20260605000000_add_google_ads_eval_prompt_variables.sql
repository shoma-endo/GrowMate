-- Google Ads AI評価プロンプトの admin/prompts 画面「使用可能な変数」一覧に
-- existingContent / rankingData を表示させるため、prompt_templates.variables 列へ追記する。
--
-- 注意:
--   - content 列は変更しない（本番で admin/prompts 画面から運用編集されており、
--     上書きすると TOP5 JSON 出力指示などの本番改修を破壊するため）。
--   - 既に同名の変数が登録済みの場合は追記しない（@> ガードで冪等）。
--   - プロンプト本文への {{existingContent}} / {{rankingData}} 追記は admin/prompts 画面で実施する。
--
-- Rollback:
--   update public.prompt_templates
--   set variables = (
--     select coalesce(jsonb_agg(elem), '[]'::jsonb)
--     from jsonb_array_elements(variables) elem
--     where elem->>'name' not in ('existingContent', 'rankingData')
--   )
--   where name = 'google_ads_ai_evaluation';

update public.prompt_templates
set
  variables = variables || '[{"name":"existingContent","description":"既存コンテンツ在庫（WordPress 由来。新規作成 vs 既存修正の判定材料）"}]'::jsonb,
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation'
  and not (variables @> '[{"name":"existingContent"}]'::jsonb);

update public.prompt_templates
set
  variables = variables || '[{"name":"rankingData","description":"GSC 自社検索順位スナップショット（カニバリ判定・順位の判定材料）"}]'::jsonb,
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation'
  and not (variables @> '[{"name":"rankingData"}]'::jsonb);
