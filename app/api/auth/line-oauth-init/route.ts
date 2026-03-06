import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { env } from '@/env';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

// Node.jsランタイムを強制（Vercelエッジ環境でのCookie永続化問題を回避）
export const runtime = 'nodejs';

/**
 * LINE OAuth state生成エンドポイント
 * セキュアなstate値を生成し、HttpOnly Cookieとして設定
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const invitationToken = searchParams.get('invitation_token');

    // セキュアなランダムstate生成（32バイト = 64文字の16進数）
    const stateArray = new Uint8Array(32);
    crypto.getRandomValues(stateArray);
    const state = Array.from(stateArray, byte => byte.toString(16).padStart(2, '0')).join('');

    const nonceArray = new Uint8Array(32);
    crypto.getRandomValues(nonceArray);
    const nonce = Array.from(nonceArray, byte => byte.toString(16).padStart(2, '0')).join('');

    // Cookieストアを取得
    const cookieStore = await cookies();

    // HttpOnly + Secure + SameSite=Lax でstate保存
    // maxAge: 1800秒（30分）に設定
    // - OAuth 2.0のstate検証として一般的な値（業界標準: 15〜30分）
    // - ユーザーがLINE認証画面で操作に時間がかかっても十分な猶予
    // - CSRF攻撃のリスクも許容範囲内
    cookieStore.set('line_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1800, // 30分間有効
      path: '/',
    });

    // nonce（使い捨てトークン）も保存
    cookieStore.set('line_oauth_nonce', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1800, // 30分間有効
      path: '/',
    });

    if (invitationToken) {
      // 招待トークンがある場合はCookieに一時保存（LINEログイン後の紐付け用）
      // 招待の有効期限（7日）と整合させるため、1週間保持
      cookieStore.set('employee_invitation_token', invitationToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7日間有効
        path: '/',
      });
    }

    // LINE OAuth認証URLを構築
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINE_CHANNEL_ID,
      redirect_uri: `${env.NEXT_PUBLIC_SITE_URL}/api/line/callback`,
      state,
      scope: 'profile openid email',
    });

    const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('LINE OAuth Init Error:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.AUTH.OAUTH_INIT_FAILED }, { status: 500 });
  }
}
