import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  ensureAuthenticated,
  clearAuthCookies,
  setAuthCookies,
} from '@/server/middleware/auth.middleware';
import { userService } from '@/server/services/userService';

export async function GET() {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const authorizationHeader = requestHeaders.get('authorization');
  const bearerToken =
    authorizationHeader && authorizationHeader.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length).trim()
      : undefined;
  const cookieAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  const accessToken = bearerToken ?? cookieAccessToken;

  if (!accessToken) {
    return NextResponse.json({ userId: null, user: null });
  }

  try {
    const authResult = await ensureAuthenticated({
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
    });

    if (authResult.error) {
      if (authResult.needsReauth) {
        await clearAuthCookies();
        return NextResponse.json({ userId: null, needsReauth: true });
      }

      return NextResponse.json({ userId: null, user: null, error: authResult.error });
    }

    let user = authResult.userDetails;
    if (authResult.viewMode && authResult.viewModeUserId) {
      const actorUserId = authResult.actorUserId;
      const actorRole = authResult.actorRole ?? null;

      if (!actorUserId || actorRole !== 'owner') {
        return NextResponse.json({
          userId: null,
          user: null,
          error: ERROR_MESSAGES.AUTH.VIEW_MODE_UNAUTHORIZED,
        });
      }

      try {
        const viewUser = await userService.getUserById(authResult.viewModeUserId);
        if (!viewUser) {
          return NextResponse.json({
            userId: null,
            user: null,
            error: ERROR_MESSAGES.AUTH.VIEW_MODE_USER_NOT_FOUND,
          });
        }
        if (viewUser.ownerUserId !== actorUserId) {
          return NextResponse.json({
            userId: null,
            user: null,
            error: ERROR_MESSAGES.AUTH.VIEW_USER_UNAUTHORIZED,
          });
        }
        user = viewUser;
      } catch (error) {
        console.error('[User Current API] Failed to fetch view user:', error);
        return NextResponse.json({
          userId: null,
          user: null,
          error: ERROR_MESSAGES.AUTH.VIEW_MODE_FETCH_FAILED,
        });
      }
    }

    // レスポンスを一度だけ作成（最小限のユーザー情報を含める）
    const response = NextResponse.json({
      userId: user?.id ?? null,
      user: user
        ? {
            id: user.id,
            fullName: user.fullName ?? null,
            role: user.role,
            lineUserId: user.lineUserId,
            lineDisplayName: user.lineDisplayName,
            linePictureUrl: user.linePictureUrl ?? null,
            ownerUserId: user.ownerUserId ?? null,
          }
        : null,
      viewMode: Boolean(authResult.viewMode),
      tokenRefreshed: Boolean(authResult.newAccessToken),
    });

    // 新しいトークンが取得された場合、クッキーを更新
    if (
      authResult.newAccessToken ||
      authResult.newRefreshToken ||
      !cookieAccessToken ||
      (bearerToken && bearerToken !== cookieAccessToken)
    ) {
      await setAuthCookies(
        authResult.newAccessToken ?? accessToken,
        authResult.newRefreshToken ?? refreshToken,
        {
          sameSite: 'strict',
          refreshTokenMaxAge: 60 * 60 * 24 * 30,
        }
      );
    }
    return response;
  } catch (error) {
    console.error('[User Current API] Error:', error);
    return NextResponse.json({ userId: null, user: null });
  }
}
