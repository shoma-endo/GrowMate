-- google_ads_ai_evaluation の variables に searchTermData を追加

update public.prompt_templates
set
  variables = '[
    {"name": "persona", "description": "ターゲットペルソナ情報"},
    {"name": "strengths", "description": "全サービスの強み（改行区切り）"},
    {"name": "keywordData", "description": "全キーワード指標（構造化テキスト）"},
    {"name": "negativeKeywords", "description": "除外キーワード一覧"},
    {"name": "searchTermData", "description": "実検索語句の表示回数・クリック数（構造化テキスト）"},
    {"name": "dateRange", "description": "分析期間"},
    {"name": "customerName", "description": "Google Adsアカウント名"}
  ]'::jsonb,
  updated_at = timezone('utc', now())
where name = 'google_ads_ai_evaluation';
