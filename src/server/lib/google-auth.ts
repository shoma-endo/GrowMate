import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { GoogleAdsService } from '@/server/services/googleAdsService';
import { SupabaseService } from '@/server/services/supabaseService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { nextJson409IfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';
import { toUser } from '@/types/user';
import { isAdmin } from '@/authUtils';

/**
 * Google OAuth 認証関連のヘルパー関数
 * Google Ads と Google Search Console の認証処理を共通化
 */

/**
 * Google Ads API用の認証・権限チェック結果
 */
export type GoogleAdsAuthResult =
  | {
      success: true;
      userId: string;
      credential: {
        accessToken: string;
        refreshToken: string;
        accessTokenExpiresAt: string;
        googleAccountEmail: string | null;
        scope: string[];
        customerId: string | null;
        managerCustomerId: string | null;
      };
    }
  | {
      success: false;
      response: NextResponse;
    };

/**
 * Google Ads API用の認証・権限チェックと認証情報取得
 * 管理者権限チェックとGoogle Ads認証情報の取得を一括で行う
 */
export async function ensureGoogleAdsAuth(): Promise<GoogleAdsAuthResult> {
  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  const conflict409 = nextJson409IfEmailLinkConflict(authResult, msg => ({ error: msg }));
  if (conflict409) {
    return { success: false, response: conflict409 };
  }
  if (authResult.error || !authResult.userId) {
    return {
      success: false,
      response: NextResponse.json(
        { error: ERROR_MESSAGES.AUTH.UNAUTHENTICATED },
        { status: 401 }
      ),
    };
  }

  // 管理者権限チェック
  const supabaseService = new SupabaseService();
  const userResult = await supabaseService.getUserById(authResult.userId);
  if (!userResult.success || !userResult.data) {
    return {
      success: false,
      response: NextResponse.json(
        { error: ERROR_MESSAGES.USER.USER_INFO_NOT_FOUND },
        { status: 500 }
      ),
    };
  }
  const user = toUser(userResult.data);
  if (!isAdmin(user.role)) {
    return {
      success: false,
      response: NextResponse.json(
        { error: ERROR_MESSAGES.USER.ADMIN_REQUIRED },
        { status: 403 }
      ),
    };
  }

  // 認証情報を取得
  const credential = await supabaseService.getGoogleAdsCredential(authResult.userId);
  if (!credential) {
    return {
      success: false,
      response: NextResponse.json(
        { error: ERROR_MESSAGES.GOOGLE_ADS.CREDENTIAL_NOT_FOUND },
        { status: 404 }
      ),
    };
  }

  return {
    success: true,
    userId: authResult.userId,
    credential: {
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken,
      accessTokenExpiresAt: credential.accessTokenExpiresAt,
      googleAccountEmail: credential.googleAccountEmail,
      scope: credential.scope,
      customerId: credential.customerId,
      managerCustomerId: credential.managerCustomerId,
    },
  };
}

/**
 * Google Ads API用のトークンリフレッシュ処理
 * トークンが期限切れの場合は自動的にリフレッシュし、更新されたトークンを返す
 */
export async function refreshGoogleAdsTokenIfNeeded(
  userId: string,
  credential: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    googleAccountEmail: string | null;
    scope: string[];
    managerCustomerId?: string | null;
  }
): Promise<
  | { success: true; accessToken: string }
  | { success: false; response: NextResponse }
> {
  const googleAdsService = new GoogleAdsService();
  const supabaseService = new SupabaseService();
  
  let accessToken = credential.accessToken;
  const expiresAt = credential.accessTokenExpiresAt
    ? new Date(credential.accessTokenExpiresAt)
    : null;
  const isExpiringSoon =
    !expiresAt || isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 60 * 1000;
  
  if (isExpiringSoon) {
    // 1分以内に期限切れ、または有効期限が不明な場合はリフレッシュ
    try {
      const refreshed = await googleAdsService.refreshAccessToken(credential.refreshToken);
      accessToken = refreshed.accessToken;

      // リフレッシュしたトークンを保存（既存スコープを保持）
      const saveResult = await supabaseService.saveGoogleAdsCredential(userId, {
        accessToken: refreshed.accessToken,
        refreshToken: credential.refreshToken,
        expiresIn: refreshed.expiresIn,
        scope: refreshed.scope || credential.scope || [],
        googleAccountEmail: credential.googleAccountEmail,
        managerCustomerId: credential.managerCustomerId,
      });
      if (!saveResult.success) {
        console.warn('Failed to persist refreshed token:', {
          userMessage: saveResult.error.userMessage,
          developerMessage: saveResult.error.developerMessage,
          context: saveResult.error.context,
        });
        // 現在のリクエストは続行可能だが、次回リクエストでは古いトークンが使用される可能性がある
      }
    } catch (err) {
      console.error('Failed to refresh access token:', err);
      return {
        success: false,
        response: NextResponse.json(
          { error: ERROR_MESSAGES.GOOGLE_ADS.TOKEN_REFRESH_FAILED },
          { status: 401 }
        ),
      };
    }
  }

  return {
    success: true,
    accessToken,
  };
}
