'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { emailLinkConflictErrorPayload } from '@/server/middleware/authMiddlewareGuards';
import { PromptService } from '@/server/services/promptService';
import { isAdmin, isUnavailable } from '@/authUtils';
import { UpdatePromptTemplateInput, PromptTemplate } from '@/types/prompt';
import { isViewModeEnabled, VIEW_MODE_ERROR_MESSAGE } from '@/server/lib/view-mode';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { User } from '@/types/user';

const promptVariableSchema = z.object({
  name: z.string().min(1, '変数名は必須です'),
  description: z.string().min(1, '変数説明は必須です'),
});

const promptSchema = z.object({
  name: z
    .string()
    .min(1, 'プロンプト名は必須です')
    .max(255, 'プロンプト名は255文字以内で入力してください'),
  display_name: z
    .string()
    .min(1, '表示名は必須です')
    .max(255, '表示名は255文字以内で入力してください'),
  content: z.string().min(1, 'プロンプト内容は必須です'),
  variables: z.array(promptVariableSchema).default([]),
});

type PromptActionResponse<T = unknown> = T extends void
  ? { success: true; error?: undefined } | { success: false; error: string }
  :
      | { success: true; data: T; error?: undefined }
      | { success: false; data?: undefined; error: string };

type AdminPermissionResult =
  | { success: false; error: string; emailLinkConflict?: true }
  | { success: true; userId: string; user: User };

/**
 * 管理者権限をチェックするヘルパー関数
 */
async function checkAdminPermission(liffAccessToken: string): Promise<AdminPermissionResult> {
  const auth = await authMiddleware(liffAccessToken);

  const linkConflict = emailLinkConflictErrorPayload(auth);
  if (linkConflict) return linkConflict;
  if (auth.error) {
    return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.AUTH_ERROR };
  }

  // authMiddleware が解決済みの userDetails を直接使用
  // （lineUserId ではなく userId ベースで解決されているため Email ユーザーでも動作する）
  const user = auth.userDetails;
  if (!user) {
    return { success: false, error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND };
  }

  if (isUnavailable(user.role)) {
    return { success: false, error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE };
  }

  if (!isAdmin(user.role)) {
    return { success: false, error: ERROR_MESSAGES.USER.ADMIN_REQUIRED };
  }

  return { success: true, userId: auth.userId, user };
}

/**
 * プロンプトテンプレートを更新
 */
export async function updatePromptTemplate(
  liffAccessToken: string,
  id: string,
  data: z.infer<typeof promptSchema>
): Promise<PromptActionResponse<PromptTemplate>> {
  try {
    // 管理者権限チェック
    const adminCheck = await checkAdminPermission(liffAccessToken);
    if (!adminCheck.success) {
      return { success: false, error: adminCheck.error || ERROR_MESSAGES.USER.PERMISSION_VERIFY_FAILED };
    }
    const adminUser = adminCheck.user;
    if (await isViewModeEnabled(adminUser.role)) {
      return { success: false, error: VIEW_MODE_ERROR_MESSAGE };
    }

    // データ検証
    const validatedData = promptSchema.parse(data);

    // 存在チェック
    const existingTemplate = await PromptService.getTemplateById(id);
    if (!existingTemplate) {
      return { success: false, error: ERROR_MESSAGES.PROMPT.NOT_FOUND };
    }

    // 名前の重複チェック（自分以外）
    if (validatedData.name !== existingTemplate.name) {
      const duplicateTemplate = await PromptService.getTemplateByName(validatedData.name);
      if (duplicateTemplate && duplicateTemplate.id !== id) {
        return { success: false, error: ERROR_MESSAGES.PROMPT.DUPLICATE_NAME };
      }
    }

    // テンプレート更新
    const updateInput: UpdatePromptTemplateInput = {
      ...validatedData,
      updated_by: adminCheck.userId!,
    };

    const result = await PromptService.updateTemplate(id, updateInput);

    // 全プロンプトキャッシュを無効化（即座反映）
    await PromptService.invalidateAllCaches();

    // 画面を再検証
    revalidatePath('/admin/prompts');
    revalidatePath(`/admin/prompts/${id}`);

    return { success: true, data: result };
  } catch (error) {
    console.error('プロンプト更新エラー:', error);
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: ERROR_MESSAGES.PROMPT.INVALID_INPUT(error.issues.map(e => e.message)),
      };
    }
    return { success: false, error: ERROR_MESSAGES.PROMPT.UPDATE_FAILED };
  }
}

/**
 * プロンプトテンプレート一覧を取得
 */
export async function getPromptTemplates(
  liffAccessToken: string
): Promise<PromptActionResponse<PromptTemplate[]>> {
  try {
    // 管理者権限チェック
    const adminCheck = await checkAdminPermission(liffAccessToken);
    if (!adminCheck.success) {
      return { success: false, error: adminCheck.error || ERROR_MESSAGES.USER.PERMISSION_VERIFY_FAILED };
    }

    const templates = await PromptService.getAllTemplates();
    return { success: true, data: templates };
  } catch (error) {
    console.error('プロンプト取得エラー:', error);
    return { success: false, error: ERROR_MESSAGES.PROMPT.FETCH_FAILED };
  }
}

