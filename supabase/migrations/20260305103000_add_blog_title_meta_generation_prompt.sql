-- blog_title_meta_generation プロンプトを管理画面で編集可能にする
INSERT INTO prompt_templates (name, display_name, content, variables, is_active)
VALUES (
  'blog_title_meta_generation',
  'ブログタイトル・説明文生成',
  '# 役割
SEO編集者として、本文と主軸キーワードに基づきタイトルと説明文を作成してください。

# 入力情報
- 主軸KW: {{contentMainKw}}
- ニーズ: {{contentNeeds}}
- ペルソナ: {{contentPersona}}
- ゴール: {{contentGoal}}
- 本文:
{{bodyContent}}

# 制約
- タイトルは全角32文字以内を目安に3案
- 説明文は全角80文字程度を目安に3案
- 主軸KW（{{contentMainKw}}）は可能な限りタイトル前方に含める
- 本文にない断定情報は追加しない

# 出力形式
1.
- タイトル:
- 説明文:

2.
- タイトル:
- 説明文:

3.
- タイトル:
- 説明文:',
  '[
    {"name": "contentMainKw", "description": "主軸KW（content_annotations.main_kw）"},
    {"name": "contentNeeds", "description": "ユーザーのニーズ"},
    {"name": "contentPersona", "description": "デモグラ・ペルソナ"},
    {"name": "contentGoal", "description": "ユーザーのゴール"},
    {"name": "bodyContent", "description": "本文（Step7生成本文、または結合本文）"}
  ]'::jsonb,
  true
)
ON CONFLICT (name)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  content = EXCLUDED.content,
  variables = EXCLUDED.variables,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- rollback:
-- DELETE FROM prompt_templates WHERE name = 'blog_title_meta_generation';
