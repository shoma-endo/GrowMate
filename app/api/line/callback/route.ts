import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/env';
import { cookies } from 'next/headers';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { userService } from '@/server/services/userService';

// Node.jsランタイムを強制（Vercelエッジ環境でのCookie永続化問題を回避）
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  // セキュアなstate検証（CSRF対策）
  const cookieStore = await cookies();
  const savedState = cookieStore.get('line_oauth_state')?.value;
  const savedNonce = cookieStore.get('line_oauth_nonce')?.value;

  // state検証: 必須・一致確認
  if (!state || !savedState || state !== savedState) {
    console.error('Invalid state parameter:', { state, savedState });
    return NextResponse.json(
      { error: ERROR_MESSAGES.AUTH.INVALID_STATE },
      { status: 403 }
    );
  }

  // nonce検証（使い捨てトークン確認）
  if (!savedNonce) {
    console.error('Missing nonce in cookies');
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.OAUTH_SESSION_INVALID }, { status: 403 });
  }

  // 使用済みのstate/nonceを即座に削除（再利用攻撃防止）
  cookieStore.delete('line_oauth_state');
  cookieStore.delete('line_oauth_nonce');

  if (!code) {
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.AUTHORIZATION_CODE_MISSING }, { status: 400 });
  }

  try {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        // redirect_uri はログインリクエスト時と同じものを指定する必要があります
        redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/line/callback`,
        client_id: env.LINE_CHANNEL_ID, // サーバーサイド用の Channel ID
        client_secret: env.LINE_CHANNEL_SECRET, // Channel Secret
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('LINE Token API Error:', tokenData);
      return NextResponse.json(
        { error: ERROR_MESSAGES.AUTH.LINE_TOKEN_FETCH_FAILED, details: tokenData },
        { status: tokenRes.status }
      );
    }

    // ここでリフレッシュトークンとアクセストークンを安全に保存します。
    // 例: データベースにユーザー情報と紐付けて保存、セッションストアに保存など。
    // Cookie に保存する場合、httpOnly, secure, sameSite 属性を適切に設定してください。

    // ユーザー情報の取得・作成 (Invitation処理のため)
    let invToken: string | undefined;
    try {
      const currentUser = await userService.getUserFromLiffToken(tokenData.access_token);

      // 招待Cookieの確認と処理
      invToken = cookieStore.get('employee_invitation_token')?.value;
      if (currentUser && invToken) {
        const acceptResult = await userService.acceptEmployeeInvitation(currentUser.id, invToken);
        if (!acceptResult.success) {
          console.error('Failed to accept invitation:', acceptResult.error);
        }
      }
    } catch (e) {
      console.error('Error in user creation/invitation processing:', e);
    }

    // ユーザーを認証後のページ（例: ホーム画面）にリダイレクト
    const redirectUrl = new URL('/', env.NEXT_PUBLIC_SITE_URL);
    const res = NextResponse.redirect(redirectUrl);

    // 招待Cookieを削除
    if (invToken) {
      res.cookies.delete('employee_invitation_token');
    }

    // Cookieにトークンを保存 (httpOnlyでJSからのアクセスを防ぐ)
    // Secure属性は HTTPS でのみ送信されるようにするため、本番環境では true を推奨
    // SameSite属性は CSRF 対策として 'Lax' または 'Strict' を推奨
    // maxAge はアクセストークンの有効期限 (秒) に合わせると良いでしょう
    res.cookies.set('line_access_token', tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokenData.expires_in,
      path: '/',
    });
    // リフレッシュトークンは有効期限が長いことが多いですが、アクセストークンよりは厳重に管理
    res.cookies.set('line_refresh_token', tokenData.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 90, // 90日（check-roleと一致）
      path: '/',
    });

    return res;
  } catch (error) {
    console.error('Callback Error:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.COMMON.SERVER_ERROR }, { status: 500 });
  }
}
