-- カオルさん共通 Google Doc 知識ソース（L1）
CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  source_url TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'global',
  prompt_template_id UUID NULL REFERENCES prompt_templates(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  last_fetch_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "管理者のみアクセス可能_knowledge_sources" ON knowledge_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role = 'admin'
    )
  );

CREATE INDEX idx_knowledge_sources_scope_active_sort
  ON knowledge_sources (scope, is_active, sort_order);

CREATE INDEX idx_knowledge_sources_sort_order
  ON knowledge_sources (sort_order ASC);
