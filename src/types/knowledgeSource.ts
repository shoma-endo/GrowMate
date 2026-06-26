export type KnowledgeSourceScope = 'global';

export interface KnowledgeSource {
  id: string;
  name: string;
  source_url: string;
  content: string;
  scope: KnowledgeSourceScope;
  prompt_template_id: string | null;
  sort_order: number;
  is_active: boolean;
  last_fetched_at: string | null;
  last_fetch_error: string | null;
  created_at: string;
  updated_at: string;
}

export type KnowledgeSourceListItem = Pick<
  KnowledgeSource,
  | 'id'
  | 'name'
  | 'source_url'
  | 'content'
  | 'sort_order'
  | 'is_active'
  | 'last_fetched_at'
  | 'last_fetch_error'
  | 'updated_at'
>;
