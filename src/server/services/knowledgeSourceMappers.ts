import type { KnowledgeSource, KnowledgeSourceListItem } from '@/types/knowledgeSource';
import type { KnowledgeSourceDbRow, KnowledgeSourceListDbRow } from '@/types/knowledgeSourceDb';

export function mapKnowledgeSourceRow(row: KnowledgeSourceDbRow): KnowledgeSource {
  return {
    id: row.id,
    name: row.name,
    source_url: row.source_url,
    content: row.content,
    scope: 'global',
    prompt_template_id: row.prompt_template_id,
    sort_order: row.sort_order,
    is_active: row.is_active,
    last_fetched_at: row.last_fetched_at,
    last_fetch_error: row.last_fetch_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapKnowledgeSourceListRow(row: KnowledgeSourceListDbRow): KnowledgeSourceListItem {
  return {
    id: row.id,
    name: row.name,
    source_url: row.source_url,
    content: row.content,
    sort_order: row.sort_order,
    is_active: row.is_active,
    last_fetched_at: row.last_fetched_at,
    last_fetch_error: row.last_fetch_error,
    updated_at: row.updated_at,
  };
}

export const KNOWLEDGE_SOURCE_LIST_COLUMNS =
  'id, name, source_url, content, sort_order, is_active, last_fetched_at, last_fetch_error, updated_at' as const;
