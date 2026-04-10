'use client';

import React, { createContext, use, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/Footer';
import type { AuthContextType, AuthProviderProps } from '@/types/components';
import type { User } from '@/types/user';
import { signOutEmail } from '@/server/actions/auth.actions';

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// 公開パス（認証不要）
const PUBLIC_PATHS = ['/home', '/privacy', '/login'] as const;

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));
}

type FetchCurrentUserResult = { user: User | null; emailLinkConflict: boolean };

async function fetchCurrentUser(): Promise<FetchCurrentUserResult> {
  const res = await fetch('/api/user/current', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (res.status === 409) {
    return { user: null, emailLinkConflict: true };
  }
  if (!res.ok) {
    return { user: null, emailLinkConflict: false };
  }
  const data = (await res.json()) as { user?: User | null };
  return { user: data?.user ?? null, emailLinkConflict: false };
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
  const publicPath = isPublicPath(pathname);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    try {
      const { user: nextUser, emailLinkConflict } = await fetchCurrentUser();
      setUser(nextUser);
      if (emailLinkConflict) {
        if (!isPublicPath(pathname)) {
          router.replace('/login?reason=email_link_conflict');
        }
        return false;
      }
      return nextUser !== null;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setUser(null);
      return false;
    }
  }, [router, pathname]);

  // 初回マウント時・パス変更時にユーザー情報を取得する。
  // middleware.ts が非公開パスでは認証を強制しているため、
  // ここでは UI 表示用のユーザー情報取得のみを行う。
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchCurrentUser()
      .then(({ user: nextUser, emailLinkConflict }) => {
        if (cancelled) return;
        setUser(nextUser);
        if (emailLinkConflict) {
          if (!publicPath) {
            router.replace('/login?reason=email_link_conflict');
          }
          return;
        }
        // 非公開パスで user が取れない場合のみ /login へ誘導（middleware の補助）
        if (!nextUser && !publicPath) {
          router.replace('/login');
        }
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Failed to load current user:', error);
        setUser(null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, publicPath, router]);

  // 非公開パスでロード中はコンテンツを隠す
  if (isLoading && !publicPath) {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="flex justify-center items-center p-8">
          <p>読み込み中...</p>
        </CardContent>
      </Card>
    );
  }

  // 旧 LINE LIFF 連携由来のフィールドは互換のため残し、常に固定値を返す。
  const contextValue: AuthContextType = {
    isLoggedIn: Boolean(user),
    isLoading,
    profile: null,
    user,
    isOwnerViewMode: false,
    isLineCookieAuth: false,
    login: () => {
      router.push('/login');
    },
    logout: async () => {
      try {
        await signOutEmail();
      } catch (error) {
        // サーバー側 signOut 失敗時もローカル状態はクリアし /login へ誘導する。
        // middleware が次回アクセス時に再検証するため、セッション残留は次リクエストで解消される。
        console.error('Failed to sign out:', error);
      } finally {
        setUser(null);
        router.push('/login');
      }
    },
    liffObject: null,
    getAccessToken: async () => '',
    refreshUser,
  };

  return (
    <AuthContext value={contextValue}>
      <div className="flex flex-col min-h-screen">
        <main className={`flex-1 ${publicPath ? '' : 'pb-20'}`}>{children}</main>
        {!publicPath && <Footer />}
      </div>
    </AuthContext>
  );
}
