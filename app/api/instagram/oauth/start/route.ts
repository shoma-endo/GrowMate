import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { generateOAuthState } from '@/server/lib/oauth-state';
import { canAccessInstagram } from '@/server/lib/instagram-permissions';
import { setOAuthStateCookie } from '@/server/lib/oauth-flow';
import { INSTAGRAM_OAUTH_SCOPES } from '@/server/services/instagramService';
import { nextResponseRedirectLoginIfEmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

const STATE_COOKIE_NAME = 'ig_oauth_state';

export async function GET(request: NextRequest) {
  const appId = process.env.INSTAGRAM_APP_ID ?? '';
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? '';
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI ?? '';
  const cookieSecret = process.env.COOKIE_SECRET ?? '';

  const isConfigured = Boolean(appId && appSecret && redirectUri && cookieSecret);

  if (!isConfigured) {
    console.error('Instagram OAuth環境変数が不足しています', {
      INSTAGRAM_APP_ID: !!appId,
      INSTAGRAM_APP_SECRET: !!appSecret,
      INSTAGRAM_REDIRECT_URI: !!redirectUri,
      COOKIE_SECRET: !!cookieSecret,
    });
    return NextResponse.json(
      {
        error:
          'Instagram連携は現在無効です。環境変数 (INSTAGRAM_APP_ID など) を設定してください。',
      },
      { status: 503 }
    );
  }

  const authResult = await authMiddleware();
  const conflictRedirect = nextResponseRedirectLoginIfEmailLinkConflict(authResult, request);
  if (conflictRedirect) return conflictRedirect;

  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'ユーザー認証に失敗しました' },
      { status: 401 }
    );
  }

  if (
    !canAccessInstagram(authResult.userDetails?.role ?? null)
  ) {
    return NextResponse.json({ error: ERROR_MESSAGES.INSTAGRAM.ACCESS_DENIED }, { status: 403 });
  }

  const { state } = generateOAuthState(authResult.userId, cookieSecret);

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_OAUTH_SCOPES.join(','),
    state,
  });

  const authorizationUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  const response = NextResponse.redirect(authorizationUrl);
  setOAuthStateCookie(response, STATE_COOKIE_NAME, state);

  return response;
}
