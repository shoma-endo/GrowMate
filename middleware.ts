import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdmin, isUnavailable } from '@/authUtils';
import { AuthEmailLinkConflictError } from '@/domain/errors/AuthEmailLinkConflictError';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { hasPaidFeatureAccess, type UserRole } from '@/types/user';
import { updateSupabaseSession } from '@/lib/supabase/middleware';

const ADMIN_REQUIRED_PATHS = ['/admin'] as const;
const PAID_FEATURE_REQUIRED_PATHS = ['/analytics'] as const;
const SETUP_PATHS = ['/setup'] as const;

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
    "img-src 'self' data: https://profile.line-scdn.net",
    `connect-src 'self'${isDev ? ' ws://localhost:* wss://localhost:*' : ''} https://oauth2.googleapis.com https://openidconnect.googleapis.com https://www.googleapis.com https://accounts.google.com https://public-api.wordpress.com https://*.supabase.co wss://*.supabase.co`,
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

        if (supabaseUser && !emailLinkConflict) {
          return redirect(new URL('/', request.url));
        }
      }
      // ホーム画面は完全に公開扱いとし、ミドルウェア側で外部サービスを呼び出さない
      // supabaseResponse を返すことで Supabase Cookie（Email セッション）を保持する
      return supabaseResponse;
    }

    // 🔍 2. 未認証の場合はログインへリダイレクト
    if (!supabaseUser) {
      return redirect(new URL('/login', request.url));
    }

    // 🔍 3. Email ユーザー認証済み: DB の role でアクセス制御
    let emailRole: UserRole | null;
    try {
      // updateSupabaseSession() が更新した sb-* Cookie を request Cookie にマージして渡す
      const cookieMap = new Map(request.cookies.getAll().map(c => [c.name, c.value]));
      for (const c of supabaseResponse.cookies.getAll()) {
        cookieMap.set(c.name, c.value);
      }
      const mergedCookieHeader = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      emailRole = await getEmailUserRoleWithCache(supabaseUser.id, request, mergedCookieHeader);
    } catch (err) {
      if (err instanceof AuthEmailLinkConflictError) {
        return redirect(new URL('/login?reason=email_link_conflict', request.url));
      }
      // 一時的な DB エラー: 未認証と同じ遷移にせず 503 で分離する
      console.error('[Middleware] Email role fetch error (transient):', err);
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
      // Supabase Cookie を削除して /login へ送る。
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
    supabaseResponse.headers.set('x-user-role', emailRole);

    // nonce ヘッダーを転送して Next.js がインラインスクリプトに nonce を付与できるようにする
    supabaseResponse.headers.set('x-nonce', nonce);

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
  return SETUP_PATHS.some(path => pathname.startsWith(path)) && !requiresGoogleAdsAccess(pathname);
}

function hasSetupAccess(role: UserRole | null): boolean {
  return hasPaidFeatureAccess(role);
}

function requiresGoogleAdsAccess(pathname: string): boolean {
  return GOOGLE_ADS_PATHS.some(path => pathname.startsWith(path));
}

// 🚀 パフォーマンス最適化：メモリキャッシュ
const roleCache = new Map<string, { role: UserRole; timestamp: number }>();
const CACHE_TTL = 30 * 1000; // 30秒キャッシュ（権限変更の反映を早くするため）

function pruneRoleCacheIfNeeded() {
  if (roleCache.size > 1000) {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of roleCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
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
  // 409: /api/auth/check-role がメール紐付け競合を返した → handleMiddleware で専用ログインへ
  if (res.status === 409) {
    throw new AuthEmailLinkConflictError();
  }
  // その他の非 2xx（5xx 等）: 一時障害 → throw して呼び出し元で 503 ハンドリングさせる
  if (!res.ok) throw new Error(`[check-role] HTTP ${res.status}`);

  const data = (await res.json()) as { role?: UserRole };
  const role = data.role ?? null;
  if (role) {
    roleCache.set(cacheKey, { role, timestamp: Date.now() });
    pruneRoleCacheIfNeeded();
  }
  return role;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and API routes
     */
    '/((?!_next/static|_next/image|_next|_vercel|_document|_not-found|_error|favicon.ico|api/).*)',
  ],
};
