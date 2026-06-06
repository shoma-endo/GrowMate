-- Google Ads AI評価プロンプトの admin/prompts 画面「使用可能な変数」一覧に
-- existingContent / rankingData を表示させるため、prompt_templates.variables 列へ追記する。
--
-- あわせて、(1) 本文末尾の「構造化データ出力(JSON)」ブロック、(2) 各提案の判定ブロック末尾の
-- [[RANKING:N]] マーカー の誤削除を防ぐため、変数一覧に注意書きエントリ（疑似変数）を追記する。
-- これらは {{...}} として本文展開されない情報専用エントリで、画面の変数一覧に常時表示され本文編集では消えない。
--
-- ※ 補足: (2) の [[RANKING:N]] マーカー方式はその後に廃止し、コード側がアンカー方式で順位ブロックを
--   差し込むよう変更した。当該注意書きエントリの除去は後続の 20260606 マイグレーションで行う
--   （本ファイルは適用済みのため履歴整合のため変更せず残す）。
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
--     where elem->>'name' not in ('existingContent', 'rankingData', '⚠️末尾の構造化データ出力JSONは削除しないこと', '⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと')
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

-- 各提案の判定ブロック末尾 [[RANKING:N]] マーカー誤削除を防ぐための注意書きエントリ（疑似変数・展開されない）
-- ※ マーカー方式は後に廃止。当該エントリは 20260606 マイグレーションで除去する（本文の追記は履歴整合のため残す）。
update public.prompt_templates
set
  variables = variables || '[{"name":"⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと","description":"各提案の「新規作成 / 既存修正の判定」ブロック末尾の [[RANKING:N]]（N=その提案の優先順位番号）は、その提案に検索順位・タイトル・URL をシステムが差し込むための目印。削除すると順位・リンクが提案内に表示されなくなる（コード: googleAdsAiAnalysisService.composeEmailMarkdown が置換する）。本文を編集する際も各提案に残すこと。"}]'::jsonb,
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation'
  and not (variables @> '[{"name":"⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと"}]'::jsonb);
