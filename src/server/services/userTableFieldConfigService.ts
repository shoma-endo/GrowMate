import { SupabaseService } from '@/server/services/supabaseService';
import {
  asPendingClient,
  type UserTableFieldConfigDatabase,
} from '@/types/database.types.pending';
import type { FieldConfigTableKey, StoredFieldConfig } from '@/types/field-config';

/**
 * 一覧テーブルの「フィールド構成」をユーザー単位で読み書きする。
 *
 * Service Role 経路のため RLS は効かない。**すべてのクエリを `user_id` でスコープすること**
 * （`.agents/skills/supabase/service-usage.md` §3）。
 */

const TABLE = 'user_table_field_configs' as const;

/** table_key ごとの保存済み構成。未保存の一覧は `null` */
type StoredFieldConfigByTableKey = Partial<
  Record<FieldConfigTableKey, StoredFieldConfig>
>;

class UserTableFieldConfigService extends SupabaseService {
  private pendingClient() {
    return asPendingClient<UserTableFieldConfigDatabase>(this.getClient());
  }

  /**
   * 対象ユーザーの全一覧分の構成をまとめて取得する。
   *
   * 一覧ごとに1クエリ投げると `/analytics` の初期表示が無駄に往復するため、1回で引く。
   * 取得に失敗しても画面は既定構成で描ける（呼び出し側が `normalizeFieldConfig` で
   * `null` を既定へ畳む）ので、例外にせず空を返す。
   */
  async getByUser(userId: string): Promise<StoredFieldConfigByTableKey> {
    const { data, error } = await this.pendingClient()
      .from(TABLE)
      .select('table_key, visible_ids, ordered_ids')
      .eq('user_id', userId);

    if (error) {
      console.error('[user-table-field-config] failed to fetch configs:', {
        userId,
        message: error.message,
      });
      return {};
    }

    const result: StoredFieldConfigByTableKey = {};
    for (const row of data ?? []) {
      result[row.table_key as FieldConfigTableKey] = {
        visibleIds: row.visible_ids,
        orderedIds: row.ordered_ids,
      };
    }
    return result;
  }

  /** 1一覧分の構成を保存する。`(user_id, table_key)` の unique 制約で upsert する */
  async upsert(params: {
    userId: string;
    tableKey: FieldConfigTableKey;
    visibleIds: string[];
    orderedIds: string[];
  }): Promise<boolean> {
    const { userId, tableKey, visibleIds, orderedIds } = params;

    const { error } = await this.pendingClient()
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          table_key: tableKey,
          visible_ids: visibleIds,
          ordered_ids: orderedIds,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,table_key' }
      );

    if (error) {
      console.error('[user-table-field-config] failed to save config:', {
        userId,
        tableKey,
        message: error.message,
      });
      return false;
    }
    return true;
  }
}

export const userTableFieldConfigService = new UserTableFieldConfigService();
