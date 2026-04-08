'use client';

import React, { createContext, use, useState, useCallback, useEffect, useRef } from 'react';
import { useLiff } from '@/hooks/useLiff';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Footer } from '@/components/Footer';
import { ViewModeBanner } from '@/components/ViewModeBanner';
import type { LiffContextType } from '@/types/components';
import type { User } from '@/types/user';
import { usePathname, useRouter } from 'next/navigation';
import { hasOwnerRole } from '@/authUtils';

const LiffContext = createContext<LiffContextType | null>(null);
const MAX_LOGIN_RETRIES = 3;
const RETRY_BACKOFF_MS = 30_000; // max retry 到達後、バックエンド回復を待つ間隔

export function useLiffContext() {
  const context = use(LiffContext);
  if (!context) {
    throw new Error('useLiffContext must be used within a LiffProvider');
  }
  return context;
}

import type { LiffProviderProps } from '@/types/components';

export function LiffProvider({ children, initialize = false }: LiffProviderProps) {
  const { isLoggedIn, isLoading, error, profile, login, logout, liffObject, initLiff } = useLiff();
  const pathname = usePathname();
  const router = useRouter();

  // 🔁 LIFFの初期化を副作用で一度だけ実行
  useEffect(() => {
    if (initialize && !isLoading && !isLoggedIn && !error) {
      initLiff().catch(e => console.error('initLiff error:', e));
    }
  }, [initialize, isLoading, isLoggedIn, error, initLiff]);

  const [syncedWithServer, setSyncedWithServer] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isOwnerViewMode, setIsOwnerViewMode] = useState(false);
  const [isLineCookieAuth, setIsLineCookieAuth] = useState(false);
  const [viewModeResolved, setViewModeResolved] = useState(false);
  const [hasServerSession, setHasServerSession] = useState<boolean | null>(null);
  // 5xx 一時障害時のリトライカウンター: インクリメントで useEffect を再実行させる
  const [loginRetryCount, setLoginRetryCount] = useState(0);
  const hasRequestedLiffLoginRef = useRef(false);
  const viewModeRetryRef = useRef(0);
  // Email ユーザー初期化の試行済みフラグ（失敗時に isInitialized を立てないため無限リトライを防ぐ）
  const emailInitAttemptedRef = useRef(false);
  function getOwnerViewModeCookie() {
    if (typeof document === 'undefined') {
      return false;
    }
    const cookies = document.cookie.split(';').map(cookie => cookie.trim());
    const hasViewMode = cookies.some(cookie => cookie.startsWith('owner_view_mode=1'));
    const hasViewUser = cookies.some(cookie => cookie.startsWith('owner_view_mode_employee_id='));
    return hasViewMode && hasViewUser;
  }

  // ✅ 最新の値を参照するためのRef
  const liffObjectRef = useRef(liffObject);
  const isLoggedInRef = useRef(isLoggedIn);

  // Refを最新の値で更新
  useEffect(() => {
    liffObjectRef.current = liffObject;
  }, [liffObject]);

  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  // ✅ 完全に安定したgetAccessToken（依存配列なし）
  const getAccessToken = useCallback(async (): Promise<string> => {
    const currentLiff = liffObjectRef.current;
    const currentLoggedIn = isLoggedInRef.current;

    if (!currentLoggedIn) {
      // Email ユーザー: LIFF 未ログインだが Supabase セッションがある場合
      // 空文字を返すと Server Action 側が Email セッションで認証を試みる
      return '';
    }

    if (!currentLiff) {
      throw new Error('LIFF is not initialized');
    }

    try {
      const token = await (
        currentLiff as unknown as { getAccessToken: () => Promise<string> }
      ).getAccessToken();
      if (token) return token;
      throw new Error('Failed to get access token from LIFF');
    } catch (error) {
      console.error('getAccessToken error:', error);
      throw new Error('LIFF is not initialized or user is not logged in');
    }
  }, []); // ✅ 依存配列完全に空

  // ✅ サーバー同期をuseEffectから分離してイベントドリブンに変更
  const syncWithServerIfNeeded = useCallback(async () => {
    if (initialize && isLoggedIn && profile && !syncedWithServer) {
      try {
        const token = await getAccessToken();
        // サーバーAPIから現在のユーザー情報を取得（Authorizationヘッダーでアクセストークンを送信）
        const res = await fetch('/api/user/current', {
          method: 'GET',
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.user) {
            setUser(data.user as User);
          } else if (data && data.userId) {
            // 最低限の情報のみ
            setUser({ id: data.userId } as User);
          }
          setIsOwnerViewMode(Boolean(data?.viewMode));
          setViewModeResolved(true);
        }
        setSyncedWithServer(true);
      } catch (error) {
        console.error('Failed to sync user ID with server:', error);
        if (!getOwnerViewModeCookie()) {
          setViewModeResolved(true);
        }
      }
    }
  }, [initialize, isLoggedIn, profile, syncedWithServer, getAccessToken]);

  // ユーザー情報を取得して state を更新する。ユーザーデータを実際に読み込めた場合は true を返す。
  // Email 初期化フローが「成功したか」を判定するために戻り値を使用する。
  const refreshUser = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      // token が空文字の場合（未ログイン状態の Email 初期化経路など）はヘッダーを送らない
      // 空文字を Bearer で送ると /api/user/current 側で LINE Cookie より優先されてしまう
      const res = await fetch('/api/user/current', {
        method: 'GET',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json() as {
          user?: User;
          userId?: string;
          viewMode?: boolean;
          authMethod?: 'liff' | 'line_cookie' | 'email';
        } | null;
        if (data && data.user) {
          setUser(data.user);
          setIsLineCookieAuth(data.authMethod === 'line_cookie');
          setIsOwnerViewMode(Boolean(data?.viewMode));
          setViewModeResolved(true);
          return true;
        } else if (data && data.userId) {
          setUser({ id: data.userId } as User);
          setIsLineCookieAuth(data.authMethod === 'line_cookie');
          setIsOwnerViewMode(Boolean(data?.viewMode));
          setViewModeResolved(true);
          return true;
        }
      }
      if (!getOwnerViewModeCookie()) {
        setViewModeResolved(true);
      }
      return false;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      if (!getOwnerViewModeCookie()) {
        setViewModeResolved(true);
      }
      return false;
    }
  }, [getAccessToken]);

  // ✅ 初期化完了時にのみサーバー同期を実行
  useEffect(() => {
    if (isLoggedIn && profile && !isInitialized) {
      syncWithServerIfNeeded();
      setIsInitialized(true);
    }
  }, [isLoggedIn, profile, isInitialized, syncWithServerIfNeeded]);

  // ✅ Email ユーザー: LIFF の初期化が完了して未ログインのまま Supabase セッションがある場合にユーザー情報取得
  // isLoading が false になるまで待つことで、LIFF 初期化中の LINE ユーザーを誤って Email ユーザーと扱わない
  // 失敗時は isInitialized を立てない（ページリロードで再試行可能）。
  // emailInitAttemptedRef で同一セッション中の無限リトライを防止する。
  useEffect(() => {
    if (!initialize || hasServerSession !== true || isLoggedIn || isInitialized || isLoading) return;
    if (emailInitAttemptedRef.current) return;
    emailInitAttemptedRef.current = true; // 並行呼び出し防止
    // refreshUser は成功時 true、失敗時 false を返す（内部で catch するため throw しない）
    // user が null のまま isInitialized を true にしないよう、true の場合のみ立てる
    // 失敗時は ref をリセットして、次の画面遷移等のタイミングで再試行できるようにする
    refreshUser().then(success => {
      if (success) {
        setIsInitialized(true);
      } else {
        emailInitAttemptedRef.current = false; // 再試行を許容
      }
    });
  }, [initialize, hasServerSession, isLoggedIn, isInitialized, isLoading, refreshUser]);

  useEffect(() => {
    const cookieViewMode = getOwnerViewModeCookie();
    if (!cookieViewMode) {
      viewModeRetryRef.current = 0;
      if (!viewModeResolved) {
        setViewModeResolved(true);
      }
      return;
    }
    if (viewModeResolved) {
      viewModeRetryRef.current = 0;
      return;
    }
    if (viewModeRetryRef.current >= 3) {
      setViewModeResolved(true);
      return;
    }
    viewModeRetryRef.current += 1;
    const retryDelayMs = 300 * viewModeRetryRef.current;
    const retryTimer = setTimeout(() => {
      refreshUser();
    }, retryDelayMs);
    return () => clearTimeout(retryTimer);
  }, [refreshUser, viewModeResolved]);

  // 公開パスの定義 - ルートを除外
  const publicPaths = ['/home', '/privacy', '/login'];
  // pathnameが取得できない場合（稀なケース）はfalseとして扱うが、SSR時はpathnameがあるため正しく判定される
  const isPublicPath = pathname
    ? publicPaths.some(
        path => pathname === path || (path !== '/' && pathname.startsWith(path + '/'))
      )
    : false;

  useEffect(() => {
    if (!pathname || isPublicPath) {
      setHasServerSession(null);
      return;
    }

    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let recoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const QUICK_RETRIES = 2;
    const RECOVERY_DELAY_MS = 15000;

    const checkSession = async (retryCount = 0) => {
      try {
        const response = await fetch('/api/auth/check-role', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (response.ok) {
          setHasServerSession(true);
          return;
        }
        if (response.status === 401 || response.status === 403) {
          setHasServerSession(false);
          return;
        }
        // 5xx: 一時障害。未認証と区別し保留にして再試行する
        if (response.status >= 500) {
          setHasServerSession(null);
          if (retryCount < QUICK_RETRIES) {
            const delayMs = 1000 * (retryCount + 1);
            retryTimeoutId = setTimeout(() => {
              retryTimeoutId = null;
              if (!cancelled) checkSession(retryCount + 1);
            }, delayMs);
          } else {
            // クイック再試行上限後も復旧チェックを続ける（手動リロード不要で復帰できるようにする）
            recoveryTimeoutId = setTimeout(() => {
              recoveryTimeoutId = null;
              if (!cancelled) checkSession(0);
            }, RECOVERY_DELAY_MS);
          }
          return;
        }
        setHasServerSession(false);
      } catch (sessionError) {
        console.error('Failed to check server session:', sessionError);
        if (!cancelled) {
          setHasServerSession(false);
        }
      }
    };

    checkSession();

    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId);
      if (recoveryTimeoutId !== null) clearTimeout(recoveryTimeoutId);
    };
  }, [isPublicPath, pathname]);

  useEffect(() => {
    if (!pathname || isPublicPath || hasServerSession !== false) {
      return;
    }

    const clientChecker = liffObject as unknown as { isInClient?: () => boolean } | null;
    const isInClient = clientChecker?.isInClient?.() ?? false;

    if (isInClient) {
      if (!isLoading && liffObject && !isLoggedIn) {
        login();
      }
      return;
    }

    router.replace('/login');
  }, [hasServerSession, isLoading, isLoggedIn, isPublicPath, liffObject, login, pathname, router]);

  useEffect(() => {
    if (!pathname) {
      return;
    }
    const cookieViewMode = getOwnerViewModeCookie();
    if (cookieViewMode && !isOwnerViewMode) {
      refreshUser();
    }
    if (!viewModeResolved) {
      return;
    }
    // Note: Owner redirect logic removed to allow owners access to all pages (e.g. /setup) without view mode
  }, [isOwnerViewMode, pathname, refreshUser, router, user?.role, viewModeResolved]);

  useEffect(() => {
    if (
      !pathname ||
      isPublicPath ||
      hasServerSession !== true ||
      isLoggedIn ||
      isLoading ||
      !liffObject ||
      hasRequestedLiffLoginRef.current
    ) {
      return;
    }

    // サーバー側の認証種別を確認してから LINE login を要求する
    // authMethod が 'email' または 'line_cookie' = LIFF login 不要
    //
    // ref の管理ルール（関数内で一元管理）:
    //   - 関数先頭で true にして並行呼び出しを防ぐ（in-flight ガード）
    //   - 「決定済み」パス（Email 確認済み / login() 呼び出し）: true のまま
    //   - 「一時障害」パス: false にリセットして次のレンダリングで再試行を許容
    // → 新しいエラーパスを追加するとき、retry したければ false、しなければ true のままにする
    let cancelled = false;
    let backoffTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const checkAndMaybeLogin = async () => {
      hasRequestedLiffLoginRef.current = true; // in-flight ガード
      try {
        const res = await fetch('/api/user/current', { credentials: 'include', cache: 'no-store' });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as {
            userId?: string;
            user?: User;
            viewMode?: boolean;
            authMethod?: 'liff' | 'line_cookie' | 'email';
          } | null;
          if (cancelled) return;
          if (data?.userId) {
            // Email ユーザーまたは LINE cookie 認証済みユーザー → LIFF login 不要、settled（ref は true のまま）
            // LINE cookie ユーザー: サーバーサイド OAuth 後に LIFF localStorage が未更新でも
            // cookie ベースの認証が有効なため liff.login() によるリダイレクトは不要。
            if (data.user) setUser(data.user);
            setIsLineCookieAuth(data.authMethod === 'line_cookie');
            setIsOwnerViewMode(Boolean(data?.viewMode));
            setViewModeResolved(true);
            setSyncedWithServer(true);
            setIsInitialized(true);
            return;
          }
        } else if (res.status >= 500) {
          // 一時障害: ref をリセットして再試行を許容
          hasRequestedLiffLoginRef.current = false;
          if (cancelled) return;
          if (loginRetryCount < MAX_LOGIN_RETRIES) {
            // retry 可: カウントアップで useEffect を再実行
            setLoginRetryCount(c => c + 1);
          } else {
            // 上限到達: hasServerSession === true なのでセッションは存在する。
            // バックエンド一時障害のため方式を LINE へ切り替えない。
            // RETRY_BACKOFF_MS 後にカウントをリセットしてセルフヒーリングを可能にする。
            backoffTimeoutId = setTimeout(() => setLoginRetryCount(0), RETRY_BACKOFF_MS);
          }
          return;
        }
      } catch {
        // ネットワークエラー → fall through して login() へ
      }
      if (cancelled) return;
      login(); // LINE login 決定 → settled（ref は true のまま）
    };

    checkAndMaybeLogin();

    return () => {
      cancelled = true;
      if (backoffTimeoutId !== null) clearTimeout(backoffTimeoutId);
    };
  }, [hasServerSession, isLoading, isLoggedIn, isPublicPath, liffObject, login, loginRetryCount, pathname]);

  // エラー表示（公開パス以外）
  if (error && !isPublicPath) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader>
          <CardTitle className="text-red-500">LIFFエラー</CardTitle>
        </CardHeader>
        <CardContent>
          <p>LIFF初期化中にエラーが発生しました。</p>
          <p className="text-sm text-gray-500">{error}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            再読み込み
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ローディング表示（公開パスの場合はローディング中もchildrenを表示させる）
  // 非公開パスでローディング中は、コンテンツを隠してローディング表示
  if (isLoading && !isPublicPath) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="flex justify-center items-center p-8">
          <p>LIFFを初期化中...</p>
        </CardContent>
      </Card>
    );
  }

  if (!isPublicPath && getOwnerViewModeCookie() && !viewModeResolved) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="flex justify-center items-center p-8">
          <p>閲覧モードを準備中...</p>
        </CardContent>
      </Card>
    );
  }

  // 🚨 修正: 未ログイン時の強制ログイン画面表示を削除
  // Middlewareがログイン状態を保証しているため、ここではチェックしない
  // これにより、サーバーサイドログイン済みだがLIFF SDK未ログインの場合もページを表示できる
  /*
  if (
    pathname &&
    !isLoggedIn &&
    liffObject &&
    !(liffObject as unknown as { isInClient: () => boolean }).isInClient() &&
    !isPublicPath
  ) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardHeader>
          <CardTitle>LINEログイン</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <p>LINEログイン画面へ移動しています...</p>
          <Button onClick={login}>ログインできない場合はこちら</Button>
        </CardContent>
      </Card>
    );
  }
  */

  return (
    <LiffContext
      value={{
        isLoggedIn,
        isLoading,
        profile,
        user,
        isOwnerViewMode,
        isLineCookieAuth,
        login,
        logout,
        liffObject,
        getAccessToken,
        refreshUser,
      }}
    >
      <div className="flex flex-col min-h-screen">
        {isOwnerViewMode && <ViewModeBanner />}
        {/* 公開ページの場合はpb-20 (フッター分の余白) を適用しない */}
        <main className={`flex-1 ${isPublicPath ? '' : 'pb-20'}`}>{children}</main>
        {/* 公開ページ以外でのみFooterを表示（閲覧モード時は表示する） */}
        {!isPublicPath && (!hasOwnerRole(user?.role ?? null) || isOwnerViewMode) && <Footer />}
      </div>
    </LiffContext>
  );
}
