-- 共通プロンプト（L1）専用 prompt_templates 行
INSERT INTO prompt_templates (name, display_name, content, variables)
VALUES (
  'global_knowledge_source',
  '共通プロンプト',
  '',
  '[]'::jsonb
)
ON CONFLICT (name) DO NOTHING;
