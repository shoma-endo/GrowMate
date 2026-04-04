import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import { generateOAuthState } from '@/server/lib/oauth-state';
import { GOOGLE_ADS_SCOPES } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { SupabaseService } from '@/server/services/supabaseService';
import { toUser } from '@/types/user';
import { isAdmin } from '@/authUtils';

export async function GET() {
  const cookieStore = await cookies();
  const liffAccessToken = cookieStore.get('line_access_token')?.value;
  const refreshToken = cookieStore.get('line_refresh_token')?.value;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI ?? ''; // Google Ads用のリダイレクトURI
  const cookieSecret = process.env.COOKIE_SECRET ?? '';
  const stateCookieName = 'gads_oauth_state'; // Cookie名を変更
  const appBaseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';

  const isConfigured = Boolean(clientId && clientSecret && redirectUri && cookieSecret);

  if (!isConfigured) {
    console.error('Google Ads OAuth環境変数が不足しています', {
      GOOGLE_OAUTH_CLIENT_ID: !!clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: !!clientSecret,
      GOOGLE_ADS_REDIRECT_URI: !!redirectUri,
      COOKIE_SECRET: !!cookieSecret,
    });
    return NextResponse.json(
      {
        error:
          'Google Ads連携は現在無効です。環境変数 (GOOGLE_ADS_REDIRECT_URI など) を設定してください。',
      },
      { status: 503 }
    );
  }

  // liffAccessToken がない場合も authMiddleware が Supabase Email セッションで解決する
  const authResult = await authMiddleware(liffAccessToken, refreshToken);
  if (authResult.error || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'ユーザー認証に失敗しました' },
      { status: 401 }
    );
  }
  if (authResult.viewMode || authResult.ownerUserId) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.AUTH.OWNER_ACCOUNT_REQUIRED },
      { status: 403 }
    );
  }

  // 管理者権限チェック（Google Ads 連携は審査完了まで管理者のみ）
  try {
    const supabaseService = new SupabaseService();
    const userResult = await supabaseService.getUserById(authResult.userId);
    if (!userResult.success || !userResult.data) {
      console.error(
        'ユーザー情報取得エラー:',
        userResult.success ? 'データなし' : userResult.error
      );
      return NextResponse.redirect(`${appBaseUrl}/setup/google-ads?error=server_error`);
    }
    const user = toUser(userResult.data);
    if (!isAdmin(user.role)) {
      console.warn('非管理者ユーザーが Google Ads 連携を試行:', authResult.userId);
      return NextResponse.redirect(`${appBaseUrl}/unauthorized`);
    }
  } catch (error) {
    console.error('管理者権限チェックエラー:', error);
    return NextResponse.redirect(`${appBaseUrl}/setup/google-ads?error=server_error`);
  }

  const { state } = generateOAuthState(authResult.userId, cookieSecret);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_ADS_SCOPES.join(' '),
    access_type: 'offline', // リフレッシュトークン取得に必須
    include_granted_scopes: 'true',
    prompt: 'consent', // 毎回同意画面を表示（デモ動画用にも推奨）
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
