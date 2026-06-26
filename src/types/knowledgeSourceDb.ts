/** migration 正本に対応する DB 行型（database.types.ts は typegen 経由で更新） */
export type KnowledgeSourceDbRow = {
  id: string;
  name: string;
  source_url: string;
  content: string;
  scope: string;
  prompt_template_id: string | null;
  sort_order: number;
  is_active: boolean;
  last_fetched_at: string | null;
  last_fetch_error: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSourceListDbRow = Pick<
  KnowledgeSourceDbRow,
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

export type KnowledgeSourceInsert = {
  name: string;
  source_url: string;
  content?: string;
  scope?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSourceUpdate = Partial<
  Pick<
    KnowledgeSourceDbRow,
    | 'name'
    | 'source_url'
    | 'content'
    | 'is_active'
    | 'last_fetched_at'
    | 'last_fetch_error'
    | 'updated_at'
  >
>;
