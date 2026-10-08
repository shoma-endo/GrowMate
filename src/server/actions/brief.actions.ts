'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { briefService } from '@/server/services/briefService';
import { briefInputSchema, type BriefInput } from '@/server/schemas/brief.schema';
import type { ZodIssue } from 'zod';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';


const supabaseService = new SupabaseService();

type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * 事業者情報を保存するServer Action
 */
export const saveBrief = async (
  payload: BriefInput
): Promise<ActionResult<null>> => {
  try {
    // バリデーション
    const validationResult = briefInputSchema.safeParse(payload);
    if (!validationResult.success) {
      const fieldErrors = validationResult.error.issues
        .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      return { success: false, error: ERROR_MESSAGES.BRIEF.INPUT_ERROR(fieldErrors) };
    }

    // 認証
    const auth = await authMiddleware();
    if (auth.error || !auth.userId) {
      return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.AUTH_ERROR_GENERIC };
    }
    const saveResult = await supabaseService.saveBrief(auth.userId, validationResult.data);

    if (!saveResult.success) {
      return { success: false, error: saveResult.error.userMessage };
    }

    return { success: true };
  } catch (error) {
    console.error('事業者情報の保存エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.BRIEF.SAVE_FAILED,
    };
  }
};

/**
 * 事業者情報を取得するServer Action
 */
export const getBrief = async (): Promise<ActionResult<BriefInput | null>> => {
  try {
    // 認証
    const auth = await authMiddleware();
    if (auth.error || !auth.userId) {
      return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.AUTH_ERROR_GENERIC };
    }
    const result = await briefService.getValidatedBriefByUserId(auth.userId);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: result.data };
  } catch (error) {
    console.error('事業者情報の取得エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.BRIEF.FETCH_FAILED,
    };
  }
};

/**
 * Server Component用：事業者情報を取得
 * Cookieからトークンを取得し、データ取得を実行
 */
export const getBriefServer = async (): Promise<ActionResult<BriefInput | null>> => {
  return getBrief();
};
