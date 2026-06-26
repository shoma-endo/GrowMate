'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { KnowledgeSourceService } from '@/server/services/knowledgeSourceService';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';

const validateAdminAccessOrError = async () => {
  const authResult = await authMiddleware();
  const linkConflict = emailLinkConflictErrorPayload(authResult);
  if (linkConflict) return linkConflict;
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }
  if (authResult.userDetails?.role !== 'admin') {
    return { error: ERROR_MESSAGES.USER.INSUFFICIENT_PERMISSIONS };
  }
  return { authResult };
};

const createKnowledgeSourceSchema = z.object({
  name: z.string().trim().min(1, '表示名は必須です').max(255),
  sourceUrl: z.string().trim().url('有効な Google ドキュメント URL を入力してください'),
  isActive: z.boolean(),
});

const updateKnowledgeSourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255).optional(),
  sourceUrl: z.string().trim().url().optional(),
  isActive: z.boolean().optional(),
});

const idSchema = z.object({
  id: z.string().uuid(),
});

export async function fetchKnowledgeSources() {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const data = await KnowledgeSourceService.listAll();
    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/knowledge-sources] fetch failed', error);
    return { success: false as const, error: 'Google ドキュメント一覧の取得に失敗しました' };
  }
}

export async function createKnowledgeSource(input: z.infer<typeof createKnowledgeSourceSchema>) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const validated = createKnowledgeSourceSchema.parse(input);
    const data = await KnowledgeSourceService.createSource(validated);
    revalidatePath('/admin/prompts');
    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/knowledge-sources] create failed', error);
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? '入力内容が不正です'
        : error instanceof Error
          ? error.message
          : 'Google ドキュメントの追加に失敗しました';
    return { success: false as const, error: message };
  }
}

export async function updateKnowledgeSource(input: z.infer<typeof updateKnowledgeSourceSchema>) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const validated = updateKnowledgeSourceSchema.parse(input);
    const updateInput: {
      name?: string;
      sourceUrl?: string;
      isActive?: boolean;
    } = {};
    if (validated.name !== undefined) updateInput.name = validated.name;
    if (validated.sourceUrl !== undefined) updateInput.sourceUrl = validated.sourceUrl;
    if (validated.isActive !== undefined) updateInput.isActive = validated.isActive;

    const data = await KnowledgeSourceService.updateSource(validated.id, updateInput);
    revalidatePath('/admin/prompts');
    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/knowledge-sources] update failed', error);
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message ?? '入力内容が不正です'
        : error instanceof Error
          ? error.message
          : 'Google ドキュメントの更新に失敗しました';
    return { success: false as const, error: message };
  }
}

export async function deleteKnowledgeSource(input: z.infer<typeof idSchema>) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const validated = idSchema.parse(input);
    await KnowledgeSourceService.deleteSource(validated.id);
    revalidatePath('/admin/prompts');
    return { success: true as const };
  } catch (error) {
    console.error('[admin/knowledge-sources] delete failed', error);
    return { success: false as const, error: 'Google ドキュメントの削除に失敗しました' };
  }
}

export async function refreshKnowledgeSource(input: z.infer<typeof idSchema>) {
  try {
    const auth = await validateAdminAccessOrError();
    if ('error' in auth) {
      return {
        success: false as const,
        error: auth.error,
        ...('emailLinkConflict' in auth && auth.emailLinkConflict
          ? { emailLinkConflict: true as const }
          : {}),
      };
    }

    const validated = idSchema.parse(input);
    const data: KnowledgeSourceListItem = await KnowledgeSourceService.fetchAndStoreContent(
      validated.id
    );
    revalidatePath('/admin/prompts');
    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/knowledge-sources] refresh failed', error);
    const message =
      error instanceof Error ? error.message : 'Google ドキュメントの取得に失敗しました';
    return { success: false as const, error: message };
  }
}
