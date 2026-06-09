-- 20260605 で一時的に追加した注意書きエントリ
-- 「⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと」を variables 列から削除する。
--
-- 背景:
--   - [[RANKING:N]] マーカー方式は廃止し、コード側（composeEmailMarkdown）が
--     「▼ 新規作成 / 既存修正の判定 ▼」見出しをアンカーに順位ブロックを自動挿入する方式に変更した。
--   - そのためプロンプト本文・変数一覧にマーカー関連の記述は不要となった。
--   - 既に当該注意書きが DB の variables 列へ登録済みのため、ファイル側の取り消しだけでは
--     画面の変数一覧から消えない。本マイグレーションで明示的に除去する。
--
-- 注意:
--   - content 列は変更しない（本番で admin/prompts 画面から運用編集されているため）。
--   - existingContent / rankingData / 「⚠️末尾の構造化データ出力JSONは削除しないこと」は引き続き有効なため残す。
--   - 当該エントリが存在する時のみ更新する（@> ガードで冪等）。
--
-- Rollback:
--   （マーカー方式は廃止済みのため復元しない。必要なら 20260605 と同形式で再追記する）

update public.prompt_templates
set
  variables = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements(variables) elem
    where elem->>'name' <> '⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと'
  ),
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation'
  and variables @> '[{"name":"⚠️判定ブロックの[[RANKING:N]]マーカーは削除しないこと"}]'::jsonb;
