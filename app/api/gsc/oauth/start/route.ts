import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { generateOAuthState } from '@/server/lib/oauth-state';
import { GOOGLE_SEARCH_CONSOLE_SCOPES } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const ALLOWED_RETURN_TO_PATHS = new Set(['/setup/gsc', '/setup/ga4']);

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const requestedReturnTo = requestUrl.searchParams.get('returnTo');
  const returnTo =
    requestedReturnTo && ALLOWED_RETURN_TO_PATHS.has(requestedReturnTo)
      ? requestedReturnTo
      : '/setup/gsc';

  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? '';
  const cookieSecret = process.env.COOKIE_SECRET ?? '';
  const stateCookieName = 'gsc_oauth_state';

  const isConfigured = Boolean(clientId && clientSecret && redirectUri && cookieSecret);

  if (!isConfigured) {
    console.error('Google Search Console OAuth環境変数が不足しています', {
      GOOGLE_OAUTH_CLIENT_ID: !!clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: !!clientSecret,
      GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: !!redirectUri,
      COOKIE_SECRET: !!cookieSecret,
    });
    return NextResponse.json(
      {
        error:
          'Google Search Console連携は現在無効です。環境変数 (GOOGLE_OAUTH_CLIENT_ID など) を設定してください。',
      },
      { status: 503 }
    );
  }

  if (!liffAccessToken) {
    return NextResponse.json({ error: 'LINE認証が必要です' }, { status: 401 });
  }

  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'ユーザー認証に失敗しました' },
      { status: 401 }
    );
  }
  if (authResult.viewMode || authResult.ownerUserId) {
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED }, { status: 403 });
  }

  const { state } = generateOAuthState(authResult.userId, cookieSecret, returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SEARCH_CONSOLE_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });

  const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(stateCookieName, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 15,
    sameSite: 'lax',
  });

  return response;
}
