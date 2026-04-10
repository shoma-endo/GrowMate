import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserRoleWithRefresh } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { resolveEmailUserWithReason } from '@/server/auth/resolveUser';
import { nextJson409EmailLinkConflict } from '@/server/middleware/authMiddlewareGuards';

// Node.jsランタイムを強制（Cookie更新の一貫性を確保）
export const runtime = 'nodejs';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const lineAccessToken = cookieStore.get('line_access_token')?.value;
    const lineRefreshToken = cookieStore.get('line_refresh_token')?.value;

    if (!lineAccessToken) {
      // access token なし: Email セッションで解決（一時障害は 503 で統一）
      const result = await resolveEmailUserWithReason();
      if (result.ok) {
        return NextResponse.json({ role: result.user.role });
      }
      if (result.reason === 'unauthenticated') {
        return NextResponse.json({ error: ERROR_MESSAGES.AUTH.NOT_AUTHENTICATED }, { status: 401 });
      }
      if (result.reason === 'email_link_conflict') {
        return nextJson409EmailLinkConflict();
      }
      return NextResponse.json(
        { error: ERROR_MESSAGES.AUTH.USER_ROLE_FETCH_FAILED },
        { status: 503 }
      );
    }

    const result = await getUserRoleWithRefresh(lineAccessToken, lineRefreshToken);

    // 再認証が必要な場合: Email セッションで救済を試みる（期限切れ LINE cookie + 有効 Email の共存対応）
    // /api/line/callback は Supabase email session を削除しないためこのケースが起こり得る
    if (result.needsReauth) {
      const emailFallback = await resolveEmailUserWithReason();
      if (emailFallback.ok === false && emailFallback.reason === 'email_link_conflict') {
        return nextJson409EmailLinkConflict();
      }
      if (emailFallback.ok) {
        // 期限切れ LINE cookie を削除してから 200 を返す。
        // 削除しないと後続の /api/user/current が stale cookie を優先して needsReauth を返し、
        // checkAndMaybeLogin() が liff.login() を再発火させてしまう。
        const response = NextResponse.json({ role: emailFallback.user.role });
        response.cookies.delete('line_access_token');
        response.cookies.delete('line_refresh_token');
        return response;
      }
      return NextResponse.json(
        { error: ERROR_MESSAGES.AUTH.TOKEN_EXPIRED_REAUTH, requires_login: true },
        { status: 401 }
      );
    }

    if (!result.role) {
      return NextResponse.json({ error: ERROR_MESSAGES.AUTH.USER_ROLE_FETCH_FAILED }, { status: 401 });
    }

    // レスポンスを作成
    const response = NextResponse.json({ role: result.role });

    // 新しいトークンが発行された場合、Cookieを更新
    if (result.newAccessToken) {
      // LINE APIレスポンスから取得したexpires_inを使用
      // expires_inが取得できない場合はデフォルト値（約30日 = 2592000秒）を使用
      const maxAge = result.expiresIn ?? 60 * 60 * 24 * 30; // デフォルト30日
      
      response.cookies.set('line_access_token', result.newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge,
        path: '/',
      });
    }

    if (result.newRefreshToken) {
      response.cookies.set('line_refresh_token', result.newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 90, // 90日
        path: '/',
      });
    }

    return response;
  } catch (error) {
    console.error('Role check API error:', error);
    return NextResponse.json({ error: ERROR_MESSAGES.COMMON.SERVER_ERROR }, { status: 503 });
  }
}
