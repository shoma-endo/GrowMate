-- Google Ads AI評価プロンプトの admin/prompts 画面「使用可能な変数」一覧に
-- existingContent / rankingData を表示させるため、prompt_templates.variables 列へ追記する。
--
-- あわせて、本文末尾の「構造化データ出力(JSON)」ブロックの誤削除を防ぐため、
-- 変数一覧に注意書きエントリ（疑似変数）を追記する。これは {{...}} として本文展開されない
-- 情報専用エントリで、画面の変数一覧に常時表示され本文編集では消えない。
--
-- 注意:
--   - content 列は変更しない（本番で admin/prompts 画面から運用編集されており、
--     上書きすると TOP5 JSON 出力指示などの本番改修を破壊するため）。
--   - 既に同名の変数が登録済みの場合は追記しない（@> ガードで冪等）。
--   - プロンプト本文への {{existingContent}} / {{rankingData}} 追記は admin/prompts 画面で実施する。
--   - 注意書きエントリは name に \w 以外の文字を含むため、万一クリック挿入されても
--     {{...}} の \w+ 展開対象にならず、プロンプト出力には影響しない。
--
-- Rollback:
--   update public.prompt_templates
--   set variables = (
--     select coalesce(jsonb_agg(elem), '[]'::jsonb)
--     from jsonb_array_elements(variables) elem
--     where elem->>'name' not in ('existingContent', 'rankingData', '⚠️末尾の構造化データ出力JSONは削除しないこと')
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

-- 本文末尾の構造化データ出力(JSON)ブロック誤削除を防ぐための注意書きエントリ（疑似変数・展開されない）
update public.prompt_templates
set
  variables = variables || '[{"name":"⚠️末尾の構造化データ出力JSONは削除しないこと","description":"本文末尾の ```json [{rank, main_kw, kw}] ``` ブロックはメール検索順位表の生成に必須。削除・改変すると順位表が出力されなくなる（コード: googleAdsAiAnalysisService.extractTopProposals が抽出する）。本文を編集する際もこのブロックは残すこと。"}]'::jsonb,
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation'
  and not (variables @> '[{"name":"⚠️末尾の構造化データ出力JSONは削除しないこと"}]'::jsonb);
