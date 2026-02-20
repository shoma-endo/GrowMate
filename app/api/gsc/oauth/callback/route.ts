import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { verifyOAuthState } from '@/server/lib/oauth-state';
import { SupabaseService } from '@/server/services/supabaseService';
import {
  GscService,
  formatGscPropertyDisplayName,
} from '@/server/services/gscService';
import { getLiffTokensFromRequest } from '@/server/lib/auth-helpers';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

const supabaseService = new SupabaseService();
const gscService = new GscService();
const ALLOWED_RETURN_TO_PATHS = new Set(['/setup/gsc', '/setup/ga4']);
const DEFAULT_REDIRECT_PATH = '/setup/gsc';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI;
  const cookieSecret = process.env.COOKIE_SECRET;
  const stateCookieName = 'gsc_oauth_state';

  const buildJsonResponse = (body: Record<string, unknown>, init: ResponseInit) => {
    const res = NextResponse.json(body, init);
    res.cookies.delete(stateCookieName);
    return res;
  };

  if (!redirectUri || !cookieSecret) {
    console.error('Google Search Console OAuth callbackの必須環境変数が不足しています');
    return buildJsonResponse({ error: 'OAuth構成が未設定です' }, { status: 500 });
  }

  if (!state) {
    return buildJsonResponse({ error: 'stateが指定されていません' }, { status: 400 });
  }

  const storedState = request.cookies.get(stateCookieName)?.value;
  if (storedState && storedState !== state) {
    console.error('GSC OAuth state mismatch', { storedState, received: state });
    return buildJsonResponse({ error: 'stateが一致しません' }, { status: 400 });
  }

  const stateVerification = verifyOAuthState(state, cookieSecret);
  if (!stateVerification.valid) {
    console.error('GSC OAuth state verification failed', stateVerification);
    return buildJsonResponse({ error: 'stateが不正です' }, { status: 400 });
  }

  if (!code) {
    return buildJsonResponse({ error: 'codeが指定されていません' }, { status: 400 });
  }

  const stateReturnTo = stateVerification.payload.returnTo;
  const returnPath =
    stateReturnTo && ALLOWED_RETURN_TO_PATHS.has(stateReturnTo)
      ? stateReturnTo
      : DEFAULT_REDIRECT_PATH;
  const appOrigin = new URL(redirectUri).origin;
  const response = NextResponse.redirect(`${appOrigin}${returnPath}?connected=1`);
  response.cookies.delete(stateCookieName);

  const { accessToken: liffAccessToken, refreshToken } = getLiffTokensFromRequest(request);

  let targetUserId: string | null = stateVerification.payload.userId;

  if (liffAccessToken) {
    const authResult = await authMiddleware(liffAccessToken, refreshToken);
    if (!authResult.error && authResult.userId) {
      if (authResult.viewMode || authResult.ownerUserId) {
        return buildJsonResponse(
          { error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED },
          { status: 403 }
        );
      }
      if (targetUserId && targetUserId !== authResult.userId) {
        console.error('LINE user mismatch between cookie and OAuth state', {
          cookieUser: authResult.userId,
          stateUser: targetUserId,
        });
        return buildJsonResponse({ error: 'ユーザー認証情報が一致しません' }, { status: 401 });
      }
      targetUserId = authResult.userId;
    }
  }

  if (!targetUserId) {
    return buildJsonResponse({ error: 'LINE認証が必要です' }, { status: 401 });
  }

  const userResult = await supabaseService.getUserById(targetUserId);
  if (!userResult.success) {
    return buildJsonResponse({ error: userResult.error.userMessage }, { status: 500 });
  }
  if (userResult.data?.owner_user_id) {
    return buildJsonResponse({ error: ERROR_MESSAGES.AUTH.STAFF_OPERATION_NOT_ALLOWED }, { status: 403 });
  }

  try {
    const tokens = await gscService.exchangeCodeForTokens(code, redirectUri);
    const existingCredential = await supabaseService.getGscCredentialByUserId(targetUserId);
    const refreshTokenToStore = tokens.refreshToken ?? existingCredential?.refreshToken;

    if (!refreshTokenToStore) {
      console.error('Missing refresh token from Google OAuth response');
      return buildJsonResponse({ error: 'リフレッシュトークンを取得できませんでした' }, { status: 400 });
    }

    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null;

    let propertyUri = existingCredential?.propertyUri ?? null;
    let propertyDisplayName = existingCredential?.propertyDisplayName ?? null;
    let propertyType = existingCredential?.propertyType ?? null;
    let permissionLevel = existingCredential?.permissionLevel ?? null;
    let verified = existingCredential?.verified ?? null;

    try {
      const sites = await gscService.listSites(tokens.accessToken);
      if (sites.length > 0) {
        const preferred =
          sites.find(site => site.permissionLevel === 'siteOwner') ||
          sites.find(site => site.permissionLevel !== 'siteUnverifiedUser') ||
          sites[0];
        if (preferred) {
          propertyUri = preferred.siteUrl;
          propertyDisplayName = preferred.displayName;
          propertyType = preferred.propertyType;
          permissionLevel = preferred.permissionLevel;
          verified = preferred.verified;
        }
      }
    } catch (error) {
      console.warn('Failed to fetch GSC sites during callback, continuing without selection', error);
    }

    let googleAccountEmail: string | null = existingCredential?.googleAccountEmail ?? null;
    try {
      const userInfo = await gscService.fetchUserInfo(tokens.accessToken);
      googleAccountEmail = userInfo.email ?? googleAccountEmail;
    } catch (error) {
      console.warn('Failed to fetch Google user info during callback', error);
    }

    await supabaseService.upsertGscCredential(targetUserId, {
      refreshToken: refreshTokenToStore,
      googleAccountEmail,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? null,
      propertyUri,
      propertyType,
      propertyDisplayName:
        propertyDisplayName && propertyUri
          ? propertyDisplayName
          : propertyUri
            ? formatGscPropertyDisplayName(propertyUri)
            : null,
      permissionLevel,
      verified,
      lastSyncedAt: new Date().toISOString(),
    });

    return response;
  } catch (error) {
    console.error('Error in Google Search Console OAuth callback', error);
    return buildJsonResponse({ error: 'Google Search Console連携に失敗しました' }, { status: 500 });
  }
}
