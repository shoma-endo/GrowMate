'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { validateGlobalKnowledgeContent } from '@/lib/globalKnowledgeContentValidation';
import { getGlobalKnowledgeSourceTemplate } from '@/server/services/globalKnowledgeContent';
import { PromptService } from '@/server/services/promptService';

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

const saveGlobalKnowledgeContentSchema = z.object({
  content: z.string(),
});

export type GlobalKnowledgeSourceSummary = {
  id: string;
  displayName: string;
  content: string;
  updatedAt: string | null;
};

export async function fetchGlobalKnowledgeSource() {
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

    const template = await getGlobalKnowledgeSourceTemplate();
    if (!template) {
      return {
        success: false as const,
        error: '共通プロンプト専用テンプレートが見つかりません。マイグレーションを適用してください。',
      };
    }

    const data: GlobalKnowledgeSourceSummary = {
      id: template.id,
      displayName: template.display_name,
      content: template.content,
      updatedAt: template.updated_at,
    };

    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/global-knowledge] fetch failed', error);
    return { success: false as const, error: '共通プロンプトの取得に失敗しました' };
  }
}

export async function saveGlobalKnowledgeContent(input: z.infer<typeof saveGlobalKnowledgeContentSchema>) {
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

    const validated = saveGlobalKnowledgeContentSchema.parse(input);
    const rejectionReason = validateGlobalKnowledgeContent(validated.content);
    if (rejectionReason) {
      return { success: false as const, error: rejectionReason };
    }

    const template = await getGlobalKnowledgeSourceTemplate();
    if (!template) {
      return {
        success: false as const,
        error: '共通プロンプト専用テンプレートが見つかりません。マイグレーションを適用してください。',
      };
    }

    const updated = await PromptService.updateTemplate(template.id, {
      content: validated.content,
      updated_by: auth.authResult.userId,
    });

    await PromptService.invalidateAllCaches();
    revalidatePath('/admin/prompts');

    const data: GlobalKnowledgeSourceSummary = {
      id: updated.id,
      displayName: updated.display_name,
      content: updated.content,
      updatedAt: updated.updated_at,
    };

    return { success: true as const, data };
  } catch (error) {
    console.error('[admin/global-knowledge] save failed', error);
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? '入力内容が不正です')
        : error instanceof Error
          ? error.message
          : '共通プロンプトの保存に失敗しました';
    return { success: false as const, error: message };
  }
}
