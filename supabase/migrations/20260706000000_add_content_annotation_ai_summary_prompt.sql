-- Add content_annotation_ai_summary prompt template

INSERT INTO prompt_templates (name, display_name, content, variables) VALUES
(
  'content_annotation_ai_summary',
  'コンテンツ情報のAI要約',
  'あなたはSEOコンテンツ戦略の専門家です。
以下のWordPress記事本文を読み、記事作成・評価に必要な情報を抽出してください。

【記事タイトル】
{{wpPostTitle}}

【記事本文】
{{wpContentText}}

【抽出する項目】
- main_kw: この記事が最も強く狙っていると思われる主軸キーワード（1つ）
- kw: 本文から連想される参考キーワード（最大5件、改行区切り。実際の検索クエリデータではなく、本文内容からの連想でよい）
- needs: 読者のニーズや課題
- persona: 想定読者のデモグラフィック情報・ペルソナ
- goal: この記事で達成したいゴール・目標
- prep: PREP法（Point/Reason/Example/Point）で整理した場合の要点
- opening_proposal: 書き出し（導入部）の方向性や冒頭で伝えている内容の要約

【出力形式】
説明文なしで、以下のJSON形式のみを ```json ``` ブロックで出力してください。

```json
{
  "main_kw": "...",
  "kw": "...",
  "needs": "...",
  "persona": "...",
  "goal": "...",
  "prep": "...",
  "opening_proposal": "..."
}
```',
  '[
    {"name": "wpPostTitle", "description": "WordPress記事タイトル"},
    {"name": "wpContentText", "description": "WordPress記事本文（プレーンテキスト化済み）"}
  ]'::jsonb
);

-- Rollback instructions:
-- DELETE FROM prompt_templates WHERE name = 'content_annotation_ai_summary';
