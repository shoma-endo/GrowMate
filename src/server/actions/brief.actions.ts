'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { SupabaseService } from '@/server/services/supabaseService';
import { BriefService } from '@/server/services/briefService';
import { briefInputSchema, type BriefInput } from '@/server/schemas/brief.schema';
import { cookies } from 'next/headers';
import type { ZodIssue } from 'zod';
import { hasOwnerRole, isActualOwner } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { getLiffTokensFromCookies } from '@/server/lib/auth-helpers';

const supabaseService = new SupabaseService();

export type ActionResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

/**
 * 事業者情報を保存するServer Action
 */
export const saveBrief = async (
  payload: BriefInput & { liffAccessToken: string }
): Promise<ActionResult<null>> => {
  try {
    const { liffAccessToken, ...formData } = payload;

    // バリデーション
    const validationResult = briefInputSchema.safeParse(formData);
    if (!validationResult.success) {
      const fieldErrors = validationResult.error.issues
        .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      return { success: false, error: ERROR_MESSAGES.BRIEF.INPUT_ERROR(fieldErrors) };
    }

    // 認証
    const auth = await authMiddleware(liffAccessToken, undefined, { allowEmailFallback: true });
    if (auth.error || !auth.userId) {
      return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.AUTH_ERROR_GENERIC };
    }
    if (auth.viewMode || hasOwnerRole(auth.userDetails?.role ?? null)) {
      return { success: false, error: ERROR_MESSAGES.USER.VIEW_MODE_OPERATION_NOT_ALLOWED };
    }

    // 事業者情報を保存（スタッフの場合はオーナーのレコードを更新）
    const targetUserId = auth.ownerUserId || auth.userId;
    const saveResult = await supabaseService.saveBrief(targetUserId, validationResult.data);

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
export const getBrief = async (
  liffAccessToken: string
): Promise<ActionResult<BriefInput | null>> => {
  try {
    const cookieStore = await cookies();
    const isViewMode = cookieStore.get('owner_view_mode')?.value === '1';
    // 認証（チャットストリームと同様、LINE 失効時は Email セッションへフォールバック）
    const auth = await authMiddleware(liffAccessToken, undefined, { allowEmailFallback: true });
    if (auth.error || !auth.userId) {
      return { success: false, error: auth.error || ERROR_MESSAGES.AUTH.AUTH_ERROR_GENERIC };
    }
    if (isActualOwner(auth.userDetails?.role ?? null, auth.ownerUserId) && !isViewMode) {
      return { success: false, error: ERROR_MESSAGES.USER.VIEW_MODE_NOT_ALLOWED };
    }

    // スタッフの場合はオーナーの事業者情報を取得
    const targetUserId = auth.ownerUserId || auth.userId;

    // 事業者情報を取得
    const briefResult = await supabaseService.getBrief(targetUserId);

    if (!briefResult.success) {
      return { success: false, error: briefResult.error.userMessage };
    }

    // データがない場合はnullを返す（null と undefined の両方を考慮）
    if (briefResult.data == null) {
      return { success: true, data: null };
    }

    // 古い形式のデータを新形式に変換（必要に応じて）
    const migratedData = BriefService.migrateOldBriefToNew(briefResult.data, targetUserId);

    // Zodスキーマでバリデーション
    const parseResult = briefInputSchema.safeParse(migratedData);
    if (!parseResult.success) {
      console.warn('事業者情報のバリデーション失敗:', parseResult.error.issues);
      return { success: false, error: ERROR_MESSAGES.BRIEF.INVALID_DATA_FORMAT };
    }

    return { success: true, data: parseResult.data };
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
  try {
    const { accessToken } = await getLiffTokensFromCookies();
    // accessToken が undefined の場合（Email ユーザー）は '' を渡し、
    // authMiddleware が Supabase セッション経由で Email 認証を試みる
    return getBrief(accessToken ?? '');
  } catch (error) {
    console.error('事業者情報の取得エラー:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.BRIEF.FETCH_FAILED,
    };
  }
};
