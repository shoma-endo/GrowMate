import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { isInstagramProfessionalAccount } from '@/types/instagram';
import {
  resolveOAuthTargetUserId,
  verifyOAuthStateCookie,
  verifySignedOAuthState,
} from '@/server/lib/oauth-flow';
import { InstagramService, INSTAGRAM_OAUTH_SCOPES } from '@/server/services/instagramService';
import { instagramMediaService } from '@/server/services/instagramMediaService';
import { SupabaseService } from '@/server/services/supabaseService';

const STATE_COOKIE_NAME = 'ig_oauth_state';

function redirectWithError(baseUrl: string, errorCode: string): NextResponse {
  const response = NextResponse.redirect(
    new URL(`/setup/instagram?error=${encodeURIComponent(errorCode)}`, baseUrl)
  );
  response.cookies.delete(STATE_COOKIE_NAME);
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  const cookieStore = await cookies();
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  const cookieSecret = process.env.COOKIE_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!redirectUri || !cookieSecret || !baseUrl) {
    console.error('Instagram OAuth callbackの必須環境変数が不足しています');
    return NextResponse.json({ error: 'OAuth構成が未設定です' }, { status: 500 });
  }

  if (oauthError) {
    console.error('[Instagram] OAuth authorization error:', oauthError);
    return redirectWithError(baseUrl, oauthError === 'access_denied' ? 'access_denied' : 'auth_failed');
  }

  if (!code || !state) {
    console.error('[Instagram] Missing code or state');
    return redirectWithError(baseUrl, 'missing_params');
  }

  try {
    const storedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
    const cookieVerification = verifyOAuthStateCookie({
      storedState,
      receivedState: state,
    });
    if (cookieVerification !== 'ok') {
      console.error('[Instagram] OAuth state cookie mismatch');
      return redirectWithError(baseUrl, 'state_cookie_mismatch');
    }

    const signedVerification = verifySignedOAuthState({ state, cookieSecret });
    if (!signedVerification.ok) {
      console.error('[Instagram] Invalid OAuth state:', signedVerification.reason);
      return redirectWithError(baseUrl, signedVerification.reason);
    }

    const authResult = await authMiddleware();
    if (authResult.emailLinkConflict) {
      return redirectWithError(baseUrl, 'email_link_conflict');
    }

    const userResolution = resolveOAuthTargetUserId({
      stateUserId: signedVerification.userId,
      sessionUserId: authResult.error || !authResult.userId ? null : authResult.userId,
    });
    if (!userResolution.ok) {
      console.error('[Instagram] OAuth user resolution failed:', userResolution.reason);
      return redirectWithError(baseUrl, userResolution.reason);
    }

    const targetUserId = userResolution.userId;
    const instagramService = new InstagramService();
    const supabaseService = new SupabaseService();

    const existingCredential = await supabaseService.getInstagramCredential(targetUserId);

    const shortLived = await instagramService.exchangeCodeForTokens(code);
    const longLived = await instagramService.exchangeForLongLivedToken(shortLived.accessToken);
    const profileResult = await instagramService.fetchProfile(longLived.accessToken);
    const profile = profileResult.data;

    if (!isInstagramProfessionalAccount(profile.accountType)) {
      console.error('[Instagram] Non-professional account type:', profile.accountType);
      return redirectWithError(baseUrl, 'not_professional_account');
    }

    if (
      existingCredential &&
      existingCredential.igUserId !== profile.igUserId
    ) {
      const purgeResult = await instagramMediaService.purgeInstagramData(targetUserId);
      if (!purgeResult.success) {
        console.error('[Instagram] Failed to purge data on account switch:', purgeResult.error);
        return redirectWithError(baseUrl, 'server_error');
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + longLived.expiresIn * 1000).toISOString();

    const saveResult = await supabaseService.saveInstagramCredential(targetUserId, {
      igUserId: profile.igUserId,
      username: profile.username,
      accountType: profile.accountType,
      profilePictureUrl: profile.profilePictureUrl,
      accessToken: longLived.accessToken,
      accessTokenExpiresAt: expiresAt,
      accessTokenIssuedAt: now.toISOString(),
      scope: [...INSTAGRAM_OAUTH_SCOPES],
    });

    if (!saveResult.success) {
      console.error('[Instagram] Failed to save credential:', saveResult.error);
      return redirectWithError(baseUrl, 'server_error');
    }

    const response = NextResponse.redirect(new URL('/setup/instagram?connected=1', baseUrl));
    response.cookies.delete(STATE_COOKIE_NAME);
    return response;
  } catch (error) {
    console.error('[Instagram] Callback error:', error);
    return redirectWithError(baseUrl, 'token_exchange_failed');
  }
}
