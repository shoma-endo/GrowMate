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
- needs: 読者のニーズ。「顕在ニーズ」（読者が自覚し、検索窓に打ち込んでいる欲求。検索キーワードになる言葉）と「潜在ニーズ」（読者が言葉にできていない不安・面倒・本当の目的。検索語にはならない感情・状況・見落としている損得）を必ず切り分け、混ぜずに箇条書きで記載する（各3〜5個）。潜在ニーズには、なぜそれが本文の内容で満たされるかを一言添える
- persona: 想定読者をたった1人に絞ったデモグラフィック・ペルソナ（複数併記は禁止）。年齢層／性別、居住地・状況、職業・立場、家族構成、検索シーン（デバイス・場面・時間帯）、心理状態（何に困り、何を避けたいか）の6項目を記載する
- goal: この記事のゴール。「読者の到達点」（読者がこの記事を読んで得られる状態、1〜2文）と「書き手（CV）の到達点」（記事がどの行動に読者を誘導しているか、1〜2文）を分けて記載する
- prep: PREP法（Point/Reason/Example/Point）で整理した場合の要点
- opening_proposal: 書き出し（導入部）の方向性や冒頭で伝えている内容の要約

【制約】
- 本文に書かれている事実だけを根拠にする。本文にない設定を創作しない
- needs・persona・goalについて断定できない箇所は「（本文からは不明）」と書く。推測で埋めない

【出力形式】
説明文なしで、以下のJSON形式のみを ```json ``` ブロックで出力してください。needs・persona・goalは、項目内に改行を含む1つの文字列値としてよい。

```json
{
  "main_kw": "...",
  "kw": "...",
  "needs": "■ 顕在ニーズ\n・...\n\n■ 潜在ニーズ\n・...（なぜ満たされるか一言）",
  "persona": "・年齢層／性別：...\n・居住地・状況：...\n・職業・立場：...\n・家族構成：...\n・検索シーン：...\n・心理状態：...",
  "goal": "・読者：...\n・書き手（CV）：...",
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
