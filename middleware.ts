import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdmin, isUnavailable, getUserRoleWithRefresh, hasOwnerRole } from '@/authUtils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';
import { updateSupabaseSession } from '@/lib/supabase/middleware';

const ADMIN_REQUIRED_PATHS = ['/admin'] as const;
const PAID_FEATURE_REQUIRED_PATHS = ['/analytics'] as const;
const SETUP_PATHS = ['/setup'] as const;

// Google Ads 連携は審査完了まで管理者のみアクセス可能
const GOOGLE_ADS_PATHS = ['/setup/google-ads', '/google-ads-dashboard'] as const;

// 認証不要なパスの定義
const PUBLIC_PATHS = ['/login', '/unauthorized', '/', '/home', '/privacy'] as const;

function buildCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https://profile.line-scdn.net data:",
    `connect-src 'self'${isDev ? ' ws://localhost:* wss://localhost:*' : ''} https://api.line.me https://oauth2.googleapis.com https://openidconnect.googleapis.com https://www.googleapis.com https://accounts.google.com https://public-api.wordpress.com https://*.supabase.co wss://*.supabase.co`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const cspHeader = buildCspHeader(nonce);
  const response = await handleMiddleware(request, nonce, cspHeader);
  response.headers.set('Content-Security-Policy', cspHeader);
  return response;
}

async function handleMiddleware(request: NextRequest, nonce: string, cspHeader: string): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  try {
    // 🔑 Supabase セッション refresh（Email ユーザーのトークン自動更新）
    // supabaseResponse を全レスポンスのベースとして使用し、Set-Cookie を確実に伝播させる
    const { supabaseResponse, supabaseUser } = await updateSupabaseSession(request, nonce, cspHeader);

    // Supabase の Set-Cookie を引き継ぎながらリダイレクトするヘルパー
    const redirect = (url: URL) => {
      const res = NextResponse.redirect(url);
      for (const cookie of supabaseResponse.cookies.getAll()) {
        res.cookies.set(cookie.name, cookie.value, cookie);
      }
      return res;
    };

    // 🔍 1. 公開パスかチェック（ただし、ログイン済みユーザーの場合はホーム画面でも権限チェックを実行）
    if (isPublicPath(pathname)) {
      // /login: 認証済みユーザーはトップへリダイレクト
      if (pathname === '/login') {
        const emailLinkConflict =
          request.nextUrl.searchParams.get('reason') === 'email_link_conflict';

        // 競合解消のため Supabase を消した直後も、LINE だけ有効だと / へ飛ばされメッセージが見えない
        if (supabaseUser && !emailLinkConflict) {
          return redirect(new URL('/', request.url));
        }
        const lineToken = request.cookies.get('line_access_token')?.value;
        const lineRefresh = request.cookies.get('line_refresh_token')?.value;
        if (lineToken && !emailLinkConflict) {
          // LINE token を検証してからリダイレクト（無効/期限切れ cookie で recovery 不能ループを防ぐ）
          const authResult = await getUserRoleWithCacheAndRefresh(lineToken, lineRefresh).catch(
            () => ({ role: null, needsReauth: true })
          );
          if (authResult.role) {
            return redirect(new URL('/', request.url));
          }
          // 無効/期限切れ: LINE cookie をクリアして /login を表示
          // nonce ヘッダーを転送して Next.js がインラインスクリプトに nonce を付与できるようにする
          const nonceHeaders = new Headers(request.headers);
          nonceHeaders.set('x-nonce', nonce);
          nonceHeaders.set('content-security-policy', cspHeader);
          const res = NextResponse.next({ request: { headers: nonceHeaders } });
          for (const cookie of supabaseResponse.cookies.getAll()) {
            res.cookies.set(cookie.name, cookie.value, cookie);
          }
          res.cookies.delete('line_access_token');
          res.cookies.delete('line_refresh_token');
          return res;
        }
      }
      // ホーム画面は完全に公開扱いとし、ミドルウェア側で外部サービスを呼び出さない
      // supabaseResponse を返すことで Supabase Cookie（Email セッション）を保持する
      return supabaseResponse;
    }

    // 🔍 3. LINE Cookie の有無を確認（Email / LINE 優先判定に使用）
    // LINE Cookie がある場合は LIFF ログイン後とみなし LINE パスを優先する
    // LINE Cookie がない場合のみ Supabase セッション（Email）を優先する
    const accessToken = request.cookies.get('line_access_token')?.value;
    const refreshToken = request.cookies.get('line_refresh_token')?.value;

    if (supabaseUser && !accessToken) {
      // Email ユーザー認証済み: DB の role でアクセス制御
      let emailRole: UserRole | null;
      try {
        // updateSupabaseSession() が更新した sb-* Cookie を request Cookie にマージして渡す
        // request.headers.get('cookie') だけでは更新前の値を内部 API に送ってしまう
        const cookieMap = new Map(request.cookies.getAll().map(c => [c.name, c.value]));
        for (const c of supabaseResponse.cookies.getAll()) {
          cookieMap.set(c.name, c.value);
        }
        const mergedCookieHeader = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        emailRole = await getEmailUserRoleWithCache(supabaseUser.id, request, mergedCookieHeader);
      } catch (err) {
        // 一時的な DB エラー: 未認証と同じ遷移にせず 503 で分離する
        // /login へ送ると supabaseUser 検知で / へ転送されユーザーが原因不明のホーム送りになる
        // 空 body だとブラウザの 503 画面のままになるため、再試行できる HTML を返す
        console.error('[Middleware] Email role fetch error (transient):', err);
        // onclick 等のインラインイベントハンドラは CSP nonce でカバーされないためJS不使用
        // <meta http-equiv="refresh"> で5秒後に自動リロード、<a href=""> でも即時再試行可能
        const html =
          '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>一時的なエラー</title></head><body style="font-family:sans-serif;max-width:480px;margin:2rem auto;padding:1rem;text-align:center"><p>サービスを一時的に利用できません。</p><p>しばらくしてから再読み込みしてください（5秒後に自動で再試行します）。</p><a href="" style="display:inline-block;padding:0.5rem 1rem;font-size:1rem;text-decoration:none;border:1px solid #ccc;border-radius:4px">今すぐ再読み込み</a></body></html>';
        const res503 = new NextResponse(html, {
          status: 503,
          headers: {
            'Retry-After': '5',
            'Content-Type': 'text/html; charset=utf-8',
          },
        });
        for (const cookie of supabaseResponse.cookies.getAll()) {
          res503.cookies.set(cookie.name, cookie.value, cookie);
        }
        return res503;
      }

      if (!emailRole) {
        // public.users に未登録の異常状態（verifyOtp 未完了等）
        // supabaseResponse を介して Supabase セッション Cookie (sb-* プレフィックス) を削除し
        // /login へ送る。削除することで次のリクエストで supabaseUser が null になりループしない。
        for (const cookie of request.cookies.getAll()) {
          if (cookie.name.startsWith('sb-')) {
            supabaseResponse.cookies.delete(cookie.name);
          }
        }
        return redirect(new URL('/login', request.url));
      }

      if (isUnavailable(emailRole)) {
        if (pathname === '/unavailable') return supabaseResponse;
        return redirect(new URL('/unavailable', request.url));
      }

      if (requiresSetupAccess(pathname) && !hasSetupAccess(emailRole)) {
        return redirect(new URL('/unauthorized', request.url));
      }
      if (requiresPaidFeatureAccess(pathname) && !hasPaidFeatureAccess(emailRole)) {
        return redirect(new URL('/unauthorized', request.url));
      }
      if (requiresAdminAccess(pathname) && !isAdmin(emailRole)) {
        return redirect(new URL('/unauthorized', request.url));
      }
      // Google Ads 機能は管理者のみ許可（LINE と同一ルール）
      if (requiresGoogleAdsAccess(pathname) && !isAdmin(emailRole)) {
        return redirect(new URL('/unauthorized', request.url));
      }

      supabaseResponse.headers.set('x-user-role', emailRole);
      return supabaseResponse;
    }

    // 🔍 4. LINE ユーザー認証（accessToken / refreshToken は上で取得済み）
    if (!accessToken) {
      return redirect(new URL('/login', request.url));
    }

    // 🔍 4. ユーザーロールの取得（リフレッシュトークン対応キャッシュ考慮）
    const authResult = await getUserRoleWithCacheAndRefresh(accessToken, refreshToken).catch(
      error => {
        console.error('[Middleware] Error in getUserRoleWithCacheAndRefresh:', error);
        return { role: null, needsReauth: true };
      }
    );

    if (!authResult.role) {
      if ('needsReauth' in authResult && authResult.needsReauth) {
        // クッキーをクリアしてログインページにリダイレクト
        const res = redirect(new URL('/login', request.url));
        res.cookies.delete('line_access_token');
        res.cookies.delete('line_refresh_token');
        return res;
      }

      return redirect(new URL('/login', request.url));
    }

    // 🔍 5. unavailableユーザーのアクセス制限チェック
    if (isUnavailable(authResult.role)) {
      // 既に/unavailableページにいる場合はそのまま通す
      if (pathname === '/unavailable') {
        return supabaseResponse;
      }
      // その他のページへのアクセスは/unavailableにリダイレクト
      return redirect(new URL('/unavailable', request.url));
    }

    // 🔍 5-1. Setup画面のアクセス制御（paid / admin / owner を許可）
    // NOTE: /setup は owner にも開放するため、paid 限定チェックより先に評価する
    if (requiresSetupAccess(pathname) && !hasSetupAccess(authResult.role)) {
      return redirect(new URL('/unauthorized', request.url));
    }

    // 🔍 5-2. 有料機能のアクセス制御（paid / admin のみ）
    if (requiresPaidFeatureAccess(pathname) && !hasPaidFeatureAccess(authResult.role)) {
      return redirect(new URL('/unauthorized', request.url));
    }

    // 🔍 6. 管理者権限チェック
    if (requiresAdminAccess(pathname)) {
      if (!isAdmin(authResult.role)) {
        return redirect(new URL('/unauthorized', request.url));
      }
    }

    // 🔍 6-1. Google Ads 機能へのアクセス制限（審査完了まで管理者のみ）
    if (requiresGoogleAdsAccess(pathname)) {
      if (!isAdmin(authResult.role)) {
        return redirect(new URL('/unauthorized', request.url));
      }
    }

    // 🔍 7. 成功時のレスポンス
    // supabaseResponse をベースにすることで Supabase Cookie（Email セッション）を保持する
    supabaseResponse.headers.set('x-user-role', authResult.role);

    // 新しいトークンがある場合はクッキーを更新
    if ('newAccessToken' in authResult && authResult.newAccessToken) {
      supabaseResponse.cookies.set('line_access_token', authResult.newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30日
      });
    }

    if ('newRefreshToken' in authResult && authResult.newRefreshToken) {
      supabaseResponse.cookies.set('line_refresh_token', authResult.newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60, // 90日
      });
    }

    return supabaseResponse;
  } catch (error) {
    // 🚨 エラーハンドリング
    console.error('[Middleware] Unexpected error:', {
      pathname,
      error: error instanceof Error ? error.message : ERROR_MESSAGES.COMMON.UNEXPECTED_ERROR,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.redirect(new URL('/login', request.url));
  }
}

// 🔧 ヘルパー関数
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(path => {
    // '/' は完全一致のみ（startsWith だと全パスにマッチするため）
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(path + '/');
  });
}

function requiresAdminAccess(pathname: string): boolean {
  return ADMIN_REQUIRED_PATHS.some(path => pathname.startsWith(path));
}

function requiresPaidFeatureAccess(pathname: string): boolean {
  return PAID_FEATURE_REQUIRED_PATHS.some(path => pathname.startsWith(path));
}

function requiresSetupAccess(pathname: string): boolean {
  return SETUP_PATHS.some(path => pathname.startsWith(path));
}

function hasSetupAccess(role: UserRole | null): boolean {
  return hasPaidFeatureAccess(role) || hasOwnerRole(role);
}

function requiresGoogleAdsAccess(pathname: string): boolean {
  return GOOGLE_ADS_PATHS.some(path => pathname.startsWith(path));
}

// 🚀 パフォーマンス最適化：メモリキャッシュ
const roleCache = new Map<string, { role: UserRole; timestamp: number }>();
const CACHE_TTL = 30 * 1000; // 30秒キャッシュ（権限変更の反映を早くするため）

function pruneRoleCacheIfNeeded() {
  if (roleCache.size > 1000) {
    const oldestKey = roleCache.keys().next().value;
    if (oldestKey) roleCache.delete(oldestKey);
  }
}

/** Email ユーザーの role を取得（キャッシュ付き）
 *
 * Service Role を必要とする DB クエリは Node runtime の Route Handler（/api/auth/check-role）
 * 側で実行する。Edge middleware に無制限キーを持ち込まないようにするため fetch で委譲する。
 */
async function getEmailUserRoleWithCache(
  supabaseAuthId: string,
  request: NextRequest,
  cookieHeader: string
): Promise<UserRole | null> {
  const cacheKey = `em:${supabaseAuthId.substring(0, 18)}`; // 'em:' + 18 chars = 20 chars
  const cached = roleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.role;
  }

  const checkRoleUrl = new URL('/api/auth/check-role', request.url);
  const res = await fetch(checkRoleUrl.toString(), {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });

  // 401: 未認証 or 未登録 → null を返して呼び出し元に未登録処理させる
  if (res.status === 401) return null;
  // 5xx: 一時障害 → throw して呼び出し元で 503 ハンドリングさせる
  if (!res.ok) throw new Error(`[check-role] HTTP ${res.status}`);

  const data = (await res.json()) as { role?: UserRole };
  const role = data.role ?? null;
  if (role) {
    roleCache.set(cacheKey, { role, timestamp: Date.now() });
    pruneRoleCacheIfNeeded();
  }
  return role;
}

async function getUserRoleWithCacheAndRefresh(accessToken: string, refreshToken?: string) {
  const cacheKey = accessToken.substring(0, 20); // セキュリティのため一部のみ使用
  const cached = roleCache.get(cacheKey);

  // キャッシュが有効かチェック
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { role: cached.role };
  }

  try {
    const result = await getUserRoleWithRefresh(accessToken, refreshToken);

    if (result.role) {
      // キャッシュに保存（新しいトークンがある場合はそれでキャッシュ）
      const tokenForCache = result.newAccessToken || accessToken;
      const cacheKeyForNewToken = tokenForCache.substring(0, 20);
      roleCache.set(cacheKeyForNewToken, { role: result.role, timestamp: Date.now() });

      // 古いキャッシュを削除
      if (result.newAccessToken && cacheKey !== cacheKeyForNewToken) {
        roleCache.delete(cacheKey);
      }

      // メモリリーク防止：古いキャッシュを削除
      pruneRoleCacheIfNeeded();
    }

    return result;
  } catch (error) {
    // キャッシュを削除
    roleCache.delete(cacheKey);
    throw error;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and API routes
     */
    '/((?!_next/static|_next/image|_next|_vercel|_document|_not-found|_error|favicon.ico|api/).*)',
  ],
};
