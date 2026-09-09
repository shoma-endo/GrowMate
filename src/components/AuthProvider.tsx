'use client';

import React, { createContext, use, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/AppShell';
import { PageLoadingSkeleton } from '@/components/PageLoadingSkeleton';
import type { AuthContextType, AuthProviderProps } from '@/types/components';
import type { User } from '@/types/user';
import { signOutEmail } from '@/server/actions/auth.actions';
import { isClientPublicPath as isPublicPath } from '@/lib/public-paths';
import { getRoleAccessRedirectPath } from '@/lib/role-access';

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

type FetchCurrentUserResult = {
  user: User | null;
  emailLinkConflict: boolean;
  roleUnavailable: boolean;
  hasFullName: boolean;
};

async function fetchCurrentUser(): Promise<FetchCurrentUserResult> {
  const res = await fetch('/api/user/current', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (res.status === 409) {
    return { user: null, emailLinkConflict: true, roleUnavailable: false, hasFullName: false };
  }
  if (res.status === 403) {
    const data = (await res.json()) as {
      roleUnavailable?: boolean;
      hasFullName?: boolean;
      user?: User | null;
    };
    if (data.roleUnavailable) {
      // 利用停止ユーザーを認証コンテキストへ載せない（isLoggedIn 副作用で通知API等が動くのを防ぐ）
      // フルネーム要否の判定だけ API レスポンスから読み取る
      return {
        user: null,
        emailLinkConflict: false,
        roleUnavailable: true,
        hasFullName: Boolean(data.hasFullName ?? data.user?.fullName?.trim()),
      };
    }
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch current user: ${res.status}`);
  }
  const data = (await res.json()) as { user?: User | null };
  const user = data?.user ?? null;
  return {
    user,
    emailLinkConflict: false,
    roleUnavailable: false,
    hasFullName: Boolean(user?.fullName?.trim()),
  };
}

// 氏名登録ダイアログを自前で出す画面。ここから追い出すと登録の途中で導線が切れる。
// '/review-login' は審査員が OTP を受け取れないため、/login へ戻すと復帰できない。
const FULL_NAME_DIALOG_PATHS = ['/login', '/review-login'];

function redirectIfNeedsFullName(
  pathname: string | null,
  router: ReturnType<typeof useRouter>
): boolean {
  if (pathname && FULL_NAME_DIALOG_PATHS.includes(pathname)) return false;
  router.replace('/login');
  return true;
}

function redirectIfRoleUnavailable(pathname: string | null, router: ReturnType<typeof useRouter>): boolean {
  if (pathname === '/unavailable') return false;
  router.replace('/unavailable');
  return true;
}

function redirectIfRoleRestricted(
  pathname: string | null,
  user: User,
  router: ReturnType<typeof useRouter>
): boolean {
  const redirectPath = getRoleAccessRedirectPath(pathname ?? '', user.role);
  if (!redirectPath) return false;
  router.replace(redirectPath);
  return true;
}

interface AuthLoadErrorProps {
  onRetry: () => void;
}

function AuthLoadError({ onRetry }: AuthLoadErrorProps) {
  return (
    <Card className="mx-auto mt-8 max-w-md" role="alert">
      <CardContent className="space-y-4 p-8 text-center">
        <div className="space-y-1">
          <p className="font-medium">ユーザー情報を確認できませんでした</p>
          <p className="text-sm text-muted-foreground">
            通信状態を確認して、もう一度お試しください。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRetry}>
          再試行
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Email セッション用の認証プロバイダ。
 * `initialize` prop は後方互換のため残しているが実質的な効果はない。
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [validatedPathname, setValidatedPathname] = useState<string | null>(null);
  const [failedPathname, setFailedPathname] = useState<string | null>(null);
  const [authRequestVersion, setAuthRequestVersion] = useState(0);
  const publicPath = isPublicPath(pathname);
  const showAppNav = !publicPath && pathname !== '/unavailable';
  const isRevalidatingPath = !isLoading && validatedPathname !== pathname;
  const hasAuthLoadError = failedPathname === pathname;
  const roleRedirectPath = user
    ? getRoleAccessRedirectPath(pathname ?? '', user.role)
    : null;

  const refreshUser = useCallback(async (): Promise<boolean> => {
    try {
      const { user: nextUser, emailLinkConflict, roleUnavailable, hasFullName } =
        await fetchCurrentUser();
      setFailedPathname(current => (current === pathname ? null : current));
      setUser(nextUser);
      if (emailLinkConflict) {
        if (!isPublicPath(pathname)) {
          setValidatedPathname(null);
          router.replace('/login?reason=email_link_conflict');
        }
        return false;
      }
      // フルネーム未登録はサービス停止より優先して登録画面へ戻す
      if (!hasFullName && (nextUser || roleUnavailable)) {
        const redirected = redirectIfNeedsFullName(pathname, router);
        setValidatedPathname(redirected ? null : pathname);
        return false;
      }
      if (roleUnavailable) {
        const redirected = redirectIfRoleUnavailable(pathname, router);
        setValidatedPathname(redirected ? null : pathname);
        return false;
      }
      if (nextUser && redirectIfRoleRestricted(pathname, nextUser, router)) {
        setValidatedPathname(null);
        return false;
      }
      if (!nextUser && !isPublicPath(pathname)) {
        setValidatedPathname(null);
        router.replace('/login');
        return false;
      }
      return nextUser !== null;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      if (!isPublicPath(pathname)) {
        setFailedPathname(pathname);
      }
      return false;
    }
  }, [router, pathname]);

  const retryAuthLoad = () => {
    setFailedPathname(null);
    setValidatedPathname(null);
    if (!user) {
      setIsLoading(true);
    }
    setAuthRequestVersion(version => version + 1);
  };

  // 初回マウント時・パス変更時にユーザー情報を取得する。
  // middleware.ts が非公開パスでは認証を強制しているため、
  // ここでは UI 表示用のユーザー情報取得のみを行う。
  useEffect(() => {
    let cancelled = false;
    let redirected = false;
    let failed = false;
    fetchCurrentUser()
      .then(({ user: nextUser, emailLinkConflict, roleUnavailable, hasFullName }) => {
        if (cancelled) return;
        setFailedPathname(current => (current === pathname ? null : current));
        setUser(nextUser);
        if (emailLinkConflict) {
          if (!publicPath) {
            redirected = true;
            router.replace('/login?reason=email_link_conflict');
          }
          return;
        }
        // フルネーム未登録はサービス停止より優先して登録画面へ戻す
        if (!hasFullName && (nextUser || roleUnavailable)) {
          redirected = redirectIfNeedsFullName(pathname, router);
          return;
        }
        if (roleUnavailable) {
          redirected = redirectIfRoleUnavailable(pathname, router);
          return;
        }
        if (nextUser && redirectIfRoleRestricted(pathname, nextUser, router)) {
          redirected = true;
          return;
        }
        // 非公開パスで user が取れない場合のみ /login へ誘導（middleware の補助）
        if (!nextUser && !publicPath) {
          redirected = true;
          router.replace('/login');
        }
      })
      .catch(error => {
        if (cancelled) return;
        failed = true;
        console.error('Failed to load current user:', error);
        if (!publicPath) {
          setFailedPathname(pathname);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        if (!redirected && !failed) {
          setValidatedPathname(pathname);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authRequestVersion, pathname, publicPath, router]);

  // 初回の認証確認中だけ保護画面全体を隠す。
  // パス変更時の再取得では AppShell を維持し、本文だけを共通スケルトンへ差し替える。
  if (isLoading && !publicPath) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="flex justify-center items-center p-8">
          <p>読み込み中...</p>
        </CardContent>
      </Card>
    );
  }

  if (hasAuthLoadError && !user && !publicPath) {
    return <AuthLoadError onRetry={retryAuthLoad} />;
  }

  // 旧 LINE LIFF 連携由来のフィールドは互換のため残し、常に固定値を返す。
  const contextValue: AuthContextType = {
    isLoggedIn: Boolean(user),
    isLoading,
    profile: null,
    user,
    login: () => {
      router.push('/login');
    },
    logout: async () => {
      // 失敗時にローカルだけクリアして /login へ飛ばすと、Cookie が残っているため proxy が
      // 認証済みとして / へ戻し「押しても何も起きない」ように見える。失敗は false で返し、
      // 呼び出し側が toast で伝える。
      try {
        const result = await signOutEmail();
        if (!result.success) {
          console.error('Failed to sign out:', result.error);
          return false;
        }
      } catch (error) {
        console.error('Failed to sign out:', error);
        return false;
      }
      setUser(null);
      router.push('/login');
      return true;
    },
    liffObject: null,
    refreshUser,
  };

  return (
    <AuthContext value={contextValue}>
      <AppShell showNav={showAppNav}>
        {!publicPath && hasAuthLoadError ? (
          <AuthLoadError onRetry={retryAuthLoad} />
        ) : !publicPath && (isRevalidatingPath || roleRedirectPath) ? (
          <PageLoadingSkeleton />
        ) : (
          children
        )}
      </AppShell>
    </AuthContext>
  );
}
