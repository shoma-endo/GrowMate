import { cookies as nextCookies } from 'next/headers';

import { LineAuthService, LineTokenExpiredError } from '@/server/services/lineAuthService';
import { userService } from '@/server/services/userService';
import { isUnavailable, isActualOwner as isActualOwnerHelper } from '@/authUtils';
import { env } from '@/env';
import { LiffError } from '@/domain/errors/LiffError';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { User, UserRole } from '@/types/user';

export interface EnsureAuthenticatedOptions {
  accessToken?: string;
  refreshToken?: string;
  allowDevelopmentBypass?: boolean;
  /**
   * true のとき、LINE トークン失敗時に Supabase Email セッションへのフォールバックを許可する。
   * LIFF SDK のキャッシュトークンが混入する可能性があるストリーミング API 専用。
   * Server Actions で明示的に liffAccessToken を渡す場合は使用しないこと（ユーザー混同防止）。
   */
  allowEmailFallback?: boolean;
}

export interface AuthenticatedUser {
  lineUserId: string;
  userId: string;
  user?: { id: string };
  userDetails?: User | null;
  viewMode?: boolean;
  viewModeUserId?: string;
  actorUserId?: string;
  actorRole?: UserRole | null;
  ownerUserId?: string | null;
  error?: string;
  /** 一時障害時は true。呼び出し元で 503 を返すために使う */
  transient?: boolean;
  newAccessToken?: string;
  newRefreshToken?: string;
  needsReauth?: boolean;
}

export type AuthMiddlewareResult = AuthenticatedUser;

export interface RefreshTokensResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  status?: number;
}

const DEFAULT_ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24 * 3; // 3日
const DEFAULT_REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 90; // 90日

export interface AuthCookieOptions {
  sameSite?: 'lax' | 'strict' | 'none';
  accessTokenMaxAge?: number;
  refreshTokenMaxAge?: number;
  secure?: boolean;
  path?: string;
}

/**
 * Email セッションを解決し、成功時は AuthenticatedUser、transient 障害時はエラー結果、
 * unauthenticated 時は null を返す。
 * 呼び出し側が null の場合のみ独自のエラーを返す。
 */
async function tryEmailFallback(): Promise<AuthenticatedUser | null> {
  const { resolveEmailUserWithReason } = await import('@/server/auth/resolveUser');
  const result = await resolveEmailUserWithReason();
  if (result.ok) {
    const emailUser = result.user;
    return {
      lineUserId: '',
      userId: emailUser.id,
      user: { id: emailUser.id },
      userDetails: emailUser,
      ownerUserId: emailUser.ownerUserId ?? null,
    };
  }
  if (result.reason === 'transient') {
    return {
      error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
      transient: true,
      lineUserId: '',
      userId: '',
      userDetails: null,
    };
  }
  return null;
}

export async function ensureAuthenticated({
  accessToken,
  refreshToken,
  allowDevelopmentBypass = true,
  allowEmailFallback = false,
}: EnsureAuthenticatedOptions): Promise<AuthenticatedUser> {
  const withTokens = (
    result: AuthenticatedUser,
    tokens: { accessToken?: string | null; refreshToken?: string | null }
  ): AuthenticatedUser => {
    if (tokens.accessToken != null) {
      result.newAccessToken = tokens.accessToken;
    }
    if (tokens.refreshToken != null) {
      result.newRefreshToken = tokens.refreshToken;
    }
    return result;
  };
  if (
    allowDevelopmentBypass &&
    process.env.NODE_ENV === 'development' &&
    accessToken === 'dummy-token'
  ) {
    return {
      lineUserId: 'dummy-line-user-id',
      userId: 'dummy-app-user-id',
      user: { id: 'dummy-app-user-id' },
      userDetails: null,
    };
  }

  if (!accessToken) {
    // Email セッションを優先して解決する。
    // /api/line/callback が Supabase Email セッションを削除するため通常は共存しないが、
    // 万が一共存する場合でも Email が勝つことで isOwnerViewMode などの誤判定を防ぐ。
    const emailResult = await tryEmailFallback();
    if (emailResult && !emailResult.error) return emailResult; // 成功のみ即座に返す

    // Email 未認証または一時障害: LINE cookie で認証を試みる
    // LIFF 未初期化の LINE cookie ユーザーが Server Actions を実行できるようにする。
    // transient の場合も LINE cookie があれば継続できる（Supabase 障害時の縮退動作）。
    // 無限ループは起きない（再帰呼び出しは accessToken が非空のため !accessToken 分岐に入らない）。
    const cookieStore = await nextCookies();
    const lineCookieToken = cookieStore.get('line_access_token')?.value;
    if (lineCookieToken) {
      const cookieRefreshToken = refreshToken ?? cookieStore.get('line_refresh_token')?.value;
      const lineResult = await ensureAuthenticated({
        accessToken: lineCookieToken,
        ...(cookieRefreshToken ? { refreshToken: cookieRefreshToken } : {}),
        allowDevelopmentBypass,
        allowEmailFallback: false,
      });
      if (!lineResult.error) return lineResult;
      // LINE も失敗: email transient があればより詳細なエラーを返す
      if (emailResult?.transient) return emailResult;
      return lineResult;
    }

    // LINE cookie なし: email transient または汎用エラー
    if (emailResult) return emailResult;
    return {
      error: ERROR_MESSAGES.AUTH.LINE_ACCESS_TOKEN_REQUIRED,
      lineUserId: '',
      userId: '',
      userDetails: null,
    };
  }

  const lineAuthService = new LineAuthService();

  let latestAccessToken: string | undefined;
  let latestRefreshToken: string | undefined;

  try {
    const verificationResult = await lineAuthService.verifyLineTokenWithRefresh(
      accessToken,
      refreshToken
    );

    if (!verificationResult.isValid || verificationResult.needsReauth) {
      // allowEmailFallback = true のときのみ Email セッションへのフォールバックを試みる。
      // LIFF SDK キャッシュ由来のトークンが混入し得るストリーミング API 専用オプション。
      // Server Actions などで明示的に liffAccessToken を渡す場合は false のままにすること。
      if (allowEmailFallback) {
        const emailResult = await tryEmailFallback();
        if (emailResult) return emailResult;
        // null = unauthenticated → LINE_TOKEN_INVALID_OR_EXPIRED にフォールスルー
      }
      return withTokens(
        {
          error: ERROR_MESSAGES.AUTH.LINE_TOKEN_INVALID_OR_EXPIRED,
          lineUserId: '',
          userId: '',
          needsReauth: Boolean(verificationResult.needsReauth),
          userDetails: null,
        },
        {
          accessToken: verificationResult.newAccessToken ?? null,
          refreshToken: verificationResult.newRefreshToken ?? null,
        }
      );
    }

    latestAccessToken = verificationResult.newAccessToken;
    latestRefreshToken = verificationResult.newRefreshToken;

    const currentAccessToken = verificationResult.newAccessToken || accessToken;
    const lineProfile = await lineAuthService.getLineProfile(currentAccessToken);

    if (!lineProfile || !lineProfile.userId) {
      return withTokens(
        {
          error: ERROR_MESSAGES.AUTH.LINE_PROFILE_FETCH_FAILED,
          lineUserId: '',
          userId: '',
          userDetails: null,
        },
        { accessToken: latestAccessToken ?? null, refreshToken: latestRefreshToken ?? null }
      );
    }

    let user = await userService.getUserFromLiffToken(currentAccessToken);
    if (!user) {
      return withTokens(
        {
          error: ERROR_MESSAGES.AUTH.LINE_USER_NOT_FOUND,
          lineUserId: lineProfile.userId,
          userId: '',
          userDetails: null,
        },
        { accessToken: latestAccessToken ?? null, refreshToken: latestRefreshToken ?? null }
      );
    }

    const cookieStore = await nextCookies();
    const isViewModeEnabled = cookieStore.get('owner_view_mode')?.value === '1';
    const viewModeUserId = cookieStore.get('owner_view_mode_employee_id')?.value;
    let isViewMode = false;
    let actorUserId: string | undefined;
    let actorRole: UserRole | null | undefined;
    let viewModeUserIdResolved: string | undefined;

    // View Mode: ownerロール（ownerUserId=null）のみ許可する
    const isActualOwner = isActualOwnerHelper(user.role, user.ownerUserId);

    if (isViewModeEnabled && viewModeUserId && isActualOwner) {
      const viewUser = await userService.getUserById(viewModeUserId);
      if (viewUser && viewUser.ownerUserId === user.id) {
        actorUserId = user.id;
        actorRole = user.role ?? null;
        user = viewUser;
        isViewMode = true;
        viewModeUserIdResolved = viewUser.id;
      }
    }

    const viewModeInfo: Pick<
      AuthenticatedUser,
      'viewMode' | 'viewModeUserId' | 'actorUserId' | 'actorRole' | 'ownerUserId'
    > = {
      ...(isViewMode ? { viewMode: true } : {}),
      ...(viewModeUserIdResolved ? { viewModeUserId: viewModeUserIdResolved } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(actorRole ? { actorRole } : {}),
      ownerUserId: user.ownerUserId ?? null,
    };

    if (isUnavailable(user.role)) {
      return withTokens(
        {
          error: ERROR_MESSAGES.USER.SERVICE_UNAVAILABLE,
          lineUserId: lineProfile.userId,
          userId: user.id,
          user: { id: user.id },
          userDetails: user,
          ...viewModeInfo,
        },
        { accessToken: latestAccessToken ?? null, refreshToken: latestRefreshToken ?? null }
      );
    }

    const baseResult: AuthenticatedUser = withTokens(
      {
        lineUserId: lineProfile.userId,
        userId: user.id,
        user: { id: user.id },
        userDetails: user,
        ...viewModeInfo,
      },
      { accessToken: latestAccessToken ?? null, refreshToken: latestRefreshToken ?? null }
    );

    if (user.role === 'admin') {
      return baseResult;
    }

    if (user.role === 'owner') {
      return baseResult;
    }
    return baseResult;
  } catch (error) {
    console.error('[Auth Middleware] Error during ensureAuthenticated:', error);

    let liffError: LiffError;
    let needsReauth = false;

    if (error instanceof LineTokenExpiredError) {
      liffError = LiffError.tokenExpired();
      needsReauth = true;
    } else {
      liffError = LiffError.loginFailed(error);
    }

    return withTokens(
      {
        error: liffError.userMessage,
        lineUserId: '',
        userId: '',
        needsReauth,
        userDetails: null,
      },
      { accessToken: latestAccessToken ?? null, refreshToken: latestRefreshToken ?? null }
    );
  }
}

export async function authMiddleware(
  liffAccessToken?: string,
  refreshTokenValue?: string,
  options?: Omit<EnsureAuthenticatedOptions, 'accessToken' | 'refreshToken'>
): Promise<AuthMiddlewareResult> {
  return ensureAuthenticated({
    ...(liffAccessToken ? { accessToken: liffAccessToken } : {}),
    ...(refreshTokenValue ? { refreshToken: refreshTokenValue } : {}),
    ...options,
  });
}

export async function refreshTokens(refreshToken: string): Promise<RefreshTokensResult> {
  try {
    const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.LINE_CHANNEL_ID,
        client_secret: env.LINE_CHANNEL_SECRET,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data?.error_description || ERROR_MESSAGES.AUTH.LINE_TOKEN_REFRESH_FAILED;
      return {
        success: false,
        error: errorMessage,
        status: response.status,
      };
    }

    return {
      success: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  } catch (error) {
    console.error('[Auth Middleware] Refresh token error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
    };
  }
}

export async function setAuthCookies(
  accessToken: string,
  refreshToken?: string,
  options: AuthCookieOptions = {}
): Promise<void> {
  const {
    sameSite = 'lax',
    accessTokenMaxAge = DEFAULT_ACCESS_TOKEN_MAX_AGE,
    refreshTokenMaxAge = DEFAULT_REFRESH_TOKEN_MAX_AGE,
    secure = process.env.NODE_ENV === 'production',
    path = '/',
  } = options;

  const cookies = await nextCookies();
  cookies.set('line_access_token', accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    path,
    maxAge: accessTokenMaxAge,
  });

  if (refreshToken) {
    cookies.set('line_refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      path,
      maxAge: refreshTokenMaxAge,
    });
  }
}

export async function clearAuthCookies(): Promise<void> {
  const cookies = await nextCookies();
  cookies.delete('line_access_token');
  cookies.delete('line_refresh_token');
}
