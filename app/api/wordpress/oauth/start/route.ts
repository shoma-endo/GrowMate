import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { generateOAuthState } from '@/server/lib/oauth-state';
import { isAdmin as isAdminRole } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const ALLOWED_RETURN_TO_PATHS = new Set(['/setup', '/setup/wordpress']);

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const requestedReturnTo = requestUrl.searchParams.get('returnTo');
  const returnTo =
    requestedReturnTo && ALLOWED_RETURN_TO_PATHS.has(requestedReturnTo)
      ? requestedReturnTo
      : '/setup/wordpress';

  const cookieStore = await cookies();
  const clientId = process.env.WORDPRESS_COM_CLIENT_ID;
  const clientSecret = process.env.WORDPRESS_COM_CLIENT_SECRET;
  const redirectUri = process.env.WORDPRESS_COM_REDIRECT_URI;
  const stateCookieName = 'wpcom_oauth_state';
  const cookieSecret = process.env.COOKIE_SECRET;

  if (!clientId || !redirectUri || !cookieSecret) {
    console.error('WordPress.com OAuth environment variables are not set.');
    console.error('Missing variables:', {
      WORDPRESS_COM_CLIENT_ID: !clientId,
      WORDPRESS_COM_CLIENT_SECRET: !clientSecret,
      WORDPRESS_COM_REDIRECT_URI: !redirectUri,
      COOKIE_SECRET: !cookieSecret,
    });
    return NextResponse.json({ error: 'OAuth 構成エラーです。' }, { status: 500 });
  }

  const accessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'LINE認証が必要です' }, { status: 401 });
  }

  const authResult = await authMiddleware(accessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'ユーザー認証に失敗しました' },
      { status: 401 }
    );
  }
  if (authResult.viewMode || authResult.ownerUserId) {
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED }, { status: 403 });
  }

  if (!isAdminRole(authResult.userDetails?.role ?? null)) {
    return NextResponse.json(
      { error: 'WordPress.com 連携は管理者のみ利用できます' },
      { status: 403 }
    );
  }

  const { state } = generateOAuthState(authResult.userId, cookieSecret, returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'global', // 'global'スコープは投稿、メディア、サイト設定など広範なアクセスを要求します。必要に応じて調整してください。
    state: state,
  });

  const authorizationUrl = `https://public-api.wordpress.com/oauth2/authorize?${params.toString()}`;

  const response = NextResponse.redirect(authorizationUrl);

  // stateをHTTP Onlyのクッキーに保存
  response.cookies.set(stateCookieName, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 15, // 15 minutes
    sameSite: 'lax',
  });

  return response;
}
