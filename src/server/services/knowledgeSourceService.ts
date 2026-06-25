import 'server-only';

import { cache } from 'react';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';
import { SupabaseService } from '@/server/services/supabaseService';
import { fetchGoogleDocPlainText, parseGoogleDocId } from '@/server/services/googleDocsService';
import { isGoogleDocsConfigured } from '@/server/lib/googleDocsCredentials';
import { validateFetchedKnowledgeContent } from '@/server/services/knowledgeSourceValidation';
import {
  deleteKnowledgeSourceById,
  getActiveKnowledgeContents,
  getKnowledgeSourceById,
  getNextKnowledgeSourceSortOrder,
  insertKnowledgeSource,
  listKnowledgeSources,
  updateKnowledgeSourceById,
} from '@/server/services/knowledgeSourceRepository';

export class KnowledgeSourceService extends SupabaseService {
  static listAll = cache(async (): Promise<KnowledgeSourceListItem[]> => {
    return KnowledgeSourceService.withServiceRoleClient(client => listKnowledgeSources(client));
  });

  static getGlobalKnowledgeContent = cache(async (): Promise<string> => {
    return KnowledgeSourceService.withServiceRoleClient(async client => {
      const parts = await getActiveKnowledgeContents(client);
      return parts.join('\n\n---\n\n');
    });
  });

  static async createSource(input: {
    name: string;
    sourceUrl: string;
    isActive: boolean;
  }): Promise<KnowledgeSourceListItem> {
    return KnowledgeSourceService.withServiceRoleClient(async client => {
      const sortOrder = await getNextKnowledgeSourceSortOrder(client);
      const now = new Date().toISOString();

      return insertKnowledgeSource(client, {
        name: input.name,
        source_url: input.sourceUrl,
        content: '',
        scope: 'global',
        sort_order: sortOrder,
        is_active: input.isActive,
        created_at: now,
        updated_at: now,
      });
    });
  }

  static async updateSource(
    id: string,
    input: {
      name?: string;
      sourceUrl?: string;
      isActive?: boolean;
    }
  ): Promise<KnowledgeSourceListItem> {
    return KnowledgeSourceService.withServiceRoleClient(async client => {
      const updatePayload: {
        name?: string;
        source_url?: string;
        is_active?: boolean;
        updated_at: string;
      } = {
        updated_at: new Date().toISOString(),
      };

      if (input.name !== undefined) updatePayload.name = input.name;
      if (input.sourceUrl !== undefined) updatePayload.source_url = input.sourceUrl;
      if (input.isActive !== undefined) updatePayload.is_active = input.isActive;

      return updateKnowledgeSourceById(client, id, updatePayload);
    });
  }

  static async deleteSource(id: string): Promise<void> {
    await KnowledgeSourceService.withServiceRoleClient(async client => {
      await deleteKnowledgeSourceById(client, id);
    });
  }

  static async fetchAndStoreContent(id: string): Promise<KnowledgeSourceListItem> {
    if (!isGoogleDocsConfigured()) {
      throw new Error('Google Docs サービスアカウントが未設定です');
    }

    console.info('[KnowledgeSourceService] fetch started', { sourceId: id });

    const source = await KnowledgeSourceService.withServiceRoleClient(async client => {
      const row = await getKnowledgeSourceById(client, id);
      if (!row) {
        throw new Error('知識ソースが見つかりません');
      }
      return row;
    });

    const documentId = parseGoogleDocId(source.source_url);
    if (!documentId) {
      console.warn('[KnowledgeSourceService] document id parse failed', { sourceId: id });
      return KnowledgeSourceService.recordFetchError(
        id,
        'Google ドキュメント URL から document ID を取得できませんでした'
      );
    }

    try {
      const fetchedText = await fetchGoogleDocPlainText(documentId);
      console.info('[KnowledgeSourceService] Google Doc fetched', {
        sourceId: id,
        documentIdLength: documentId.length,
        fetchedChars: fetchedText.length,
      });

      const activeSources = await KnowledgeSourceService.listAll();
      const activeContents = activeSources
        .filter(item => item.is_active && item.id !== id)
        .map(item => item.content);

      const rejectionReason = validateFetchedKnowledgeContent(fetchedText, activeContents);
      if (rejectionReason) {
        console.warn('[KnowledgeSourceService] fetched content rejected', {
          sourceId: id,
          fetchedChars: fetchedText.length,
          activeComparisonCount: activeContents.length,
          reason: rejectionReason,
        });
        return KnowledgeSourceService.recordFetchError(id, rejectionReason);
      }

      const now = new Date().toISOString();
      const updated = await KnowledgeSourceService.withServiceRoleClient(async client =>
        updateKnowledgeSourceById(client, id, {
          content: fetchedText,
          last_fetched_at: now,
          last_fetch_error: null,
          updated_at: now,
        })
      );
      console.info('[KnowledgeSourceService] fetched content stored', {
        sourceId: id,
        fetchedChars: fetchedText.length,
        lastFetchedAt: now,
      });
      return updated;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google ドキュメントの取得に失敗しました';
      console.warn('[KnowledgeSourceService] fetch failed', {
        sourceId: id,
        message,
      });
      return KnowledgeSourceService.recordFetchError(id, message);
    }
  }

  private static async recordFetchError(
    id: string,
    message: string
  ): Promise<KnowledgeSourceListItem> {
    const now = new Date().toISOString();

    const updated = await KnowledgeSourceService.withServiceRoleClient(async client =>
      updateKnowledgeSourceById(client, id, {
        last_fetch_error: message,
        updated_at: now,
      })
    );
    console.warn('[KnowledgeSourceService] fetch error recorded', {
      sourceId: id,
      message,
      updatedAt: now,
    });
    return updated;
  }
}
