BEGIN;

-- タイトル・説明文生成用プロンプトテンプレート追加
INSERT INTO prompt_templates (name, display_name, content, variables) VALUES
(
  'blog_title_meta_generation',
  'ブログ: タイトル・説明文生成',
  '以下の条件でブログのタイトルと説明文を3案作成してください。

## 読み込む情報

ビジョン・強み・ペルソナ：
- ペルソナ: {{contentPersona}}
- 強み: {{strength}}

本文URL：{{contentCanonicalUrl}}

本文：
{{contentWpContentText}}

## キーワード条件

メインキーワード（必須・タイトル前半に配置）：{{contentMainKw}}

サブキーワード（単語を拾う）：{{contentKw}}

## 出力条件

タイトル：全角32文字以内、メインキーワードを前半に含む

説明文：全角100文字以内

3案それぞれに「ペルソナのどの心理に刺さるか」の軸を設定すること

## 出力形式

各案をコピペできる状態で出力。文字数も表示すること。',
  '[
    {"name": "contentPersona", "description": "ペルソナ（content_annotations.persona）"},
    {"name": "strength", "description": "選択中サービスの強み（briefs/services.strength）"},
    {"name": "contentCanonicalUrl", "description": "記事URL（content_annotations.canonical_url）"},
    {"name": "contentWpContentText", "description": "WordPress本文テキスト（content_annotations.wp_content_text）"},
    {"name": "contentMainKw", "description": "主軸キーワード（content_annotations.main_kw）"},
    {"name": "contentKw", "description": "参考キーワード（content_annotations.kw）"}
  ]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
