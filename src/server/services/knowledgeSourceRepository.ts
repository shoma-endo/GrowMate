import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import type { DatabaseWithKnowledgeSources } from '@/types/databaseKnowledgeSourcesExtension';
import type { KnowledgeSourceInsert, KnowledgeSourceUpdate } from '@/types/knowledgeSourceDb';
import {
  KNOWLEDGE_SOURCE_LIST_COLUMNS,
  mapKnowledgeSourceListRow,
  mapKnowledgeSourceRow,
} from '@/server/services/knowledgeSourceMappers';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';

function asKnowledgeClient(client: SupabaseClient<Database>): SupabaseClient<DatabaseWithKnowledgeSources> {
  return client as SupabaseClient<DatabaseWithKnowledgeSources>;
}

export async function listKnowledgeSources(client: SupabaseClient<Database>): Promise<KnowledgeSourceListItem[]> {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .select(KNOWLEDGE_SOURCE_LIST_COLUMNS)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`知識ソースの取得に失敗しました: ${error.message}`);
  }

  return (data ?? []).map(mapKnowledgeSourceListRow);
}

export async function getActiveKnowledgeContents(client: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .select('content')
    .eq('scope', 'global')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`知識ソースの取得に失敗しました: ${error.message}`);
  }

  return (data ?? []).map(row => row.content.trim()).filter(content => content.length > 0);
}

export async function getKnowledgeSourceById(client: SupabaseClient<Database>, id: string) {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`知識ソースの取得に失敗しました: ${error.message}`);
  }

  return data ? mapKnowledgeSourceRow(data) : null;
}

export async function insertKnowledgeSource(
  client: SupabaseClient<Database>,
  input: KnowledgeSourceInsert
): Promise<KnowledgeSourceListItem> {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .insert(input)
    .select(KNOWLEDGE_SOURCE_LIST_COLUMNS)
    .single();

  if (error) {
    throw new Error(`知識ソースの作成に失敗しました: ${error.message}`);
  }
  if (!data) {
    throw new Error('知識ソースの作成に失敗しました: 作成結果が返されませんでした');
  }

  return mapKnowledgeSourceListRow(data);
}

export async function updateKnowledgeSourceById(
  client: SupabaseClient<Database>,
  id: string,
  update: KnowledgeSourceUpdate
): Promise<KnowledgeSourceListItem> {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .update(update)
    .eq('id', id)
    .select(KNOWLEDGE_SOURCE_LIST_COLUMNS)
    .single();

  if (error) {
    throw new Error(`知識ソースの更新に失敗しました: ${error.message}`);
  }
  if (!data) {
    throw new Error('知識ソースの更新に失敗しました: 更新結果が返されませんでした');
  }

  return mapKnowledgeSourceListRow(data);
}

export async function deleteKnowledgeSourceById(client: SupabaseClient<Database>, id: string): Promise<void> {
  const { error } = await asKnowledgeClient(client).from('knowledge_sources').delete().eq('id', id);
  if (error) {
    throw new Error(`知識ソースの削除に失敗しました: ${error.message}`);
  }
}

export async function getNextKnowledgeSourceSortOrder(client: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await asKnowledgeClient(client)
    .from('knowledge_sources')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`sort_order の取得に失敗しました: ${error.message}`);
  }

  return (data?.sort_order ?? -1) + 1;
}
