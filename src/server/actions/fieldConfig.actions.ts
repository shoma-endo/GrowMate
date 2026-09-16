'use server';

import { z } from 'zod';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { isWithAuthEmailLinkConflict, withAuth } from '@/server/middleware/withAuth.middleware';
import {
  saveFieldConfigSchema,
  type SaveFieldConfigInput,
} from '@/server/schemas/fieldConfig.schema';
import { userTableFieldConfigService } from '@/server/services/userTableFieldConfigService';
import type { ServerActionResult } from '@/lib/async-handler';

/**
 * 一覧テーブルの「フィールド構成」を保存する。
 *
 * 保存先は認証ユーザー自身の行だけ。`userId` はクライアントから受け取らず、
 * サーバー側のセッションから解決する（UI の制御だけに頼らない）。
 * ロールによる出し分けはしない（既存の localStorage 保存と同じく全ロールが使える）。
 */
export async function saveFieldConfig(
  input: SaveFieldConfigInput
): Promise<ServerActionResult<never>> {
  const parsed = saveFieldConfigSchema.safeParse(input);
  if (!parsed.success) {
    console.error('[fieldConfig.actions] validation failed:', z.prettifyError(parsed.error));
    return { success: false, error: ERROR_MESSAGES.COMMON.VALIDATION_FAILED };
  }

  try {
    const result = await withAuth(async ({ userId }) => {
      const saved = await userTableFieldConfigService.upsert({
        userId,
        tableKey: parsed.data.tableKey,
        visibleIds: parsed.data.visibleIds,
        orderedIds: parsed.data.orderedIds,
      });

      return saved
        ? { success: true as const }
        : { success: false as const, error: ERROR_MESSAGES.FIELD_CONFIG.SAVE_FAILED };
    });

    if (isWithAuthEmailLinkConflict(result)) {
      return { success: false, error: result.error, emailLinkConflict: true };
    }

    return result;
  } catch (error) {
    // withAuth は未認証のとき throw する。Network Boundary を越えて Error を漏らさない
    console.error('[fieldConfig.actions] unexpected failure:', error);
    return { success: false, error: ERROR_MESSAGES.FIELD_CONFIG.SAVE_FAILED };
  }
}
