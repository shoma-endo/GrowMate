'use client';

import React, { createContext, use, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/Footer';
import type { LiffContextType, LiffProviderProps } from '@/types/components';
import type { User } from '@/types/user';
import { signOutEmail } from '@/server/actions/auth.actions';

const LiffContext = createContext<LiffContextType | null>(null);

export function useLiffContext() {
  const context = use(LiffContext);
  if (!context) {
    throw new Error('useLiffContext must be used within a LiffProvider');
  }
  return context;
}

// 公開パス（認証不要）
const PUBLIC_PATHS = ['/home', '/privacy', '/login'] as const;

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));
}

async function fetchCurrentUser(): Promise<User | null> {
  const res = await fetch('/api/user/current', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: User | null };
  return data?.user ?? null;
}

/**
 * Email 専用の認証プロバイダ。
 *
 * 名称・export は LiffProvider / useLiffContext のまま維持しているが、
 * LINE LIFF SDK への依存は Phase 1.5 で撤去済み。将来的に AuthProvider へリネーム予定。
 * `initialize` prop は後方互換のため残しているが実質的な効果はない。
 */
export function LiffProvider({ children }: LiffProviderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const publicPath = isPublicPath(pathname);

  const refreshUser = useCallback(async (): Promise<boolean> => {
    try {
      const fetched = await fetchCurrentUser();
      setUser(fetched);
      return fetched !== null;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setUser(null);
      return false;
    }
  }, []);

  // 初回マウント時・パス変更時にユーザー情報を取得する。
  // middleware.ts が非公開パスでは認証を強制しているため、
  // ここでは UI 表示用のユーザー情報取得のみを行う。
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchCurrentUser()
      .then(fetched => {
        if (cancelled) return;
        setUser(fetched);
        // 非公開パスで user が取れない場合のみ /login へ誘導（middleware の補助）
        if (!fetched && !publicPath) {
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

  // LINE LIFF 由来のフィールドは後方互換のため残置し、常に固定値を返す。
  // 将来的に useLiffContext を useAuth にリネームする際にあわせて削除する。
  const contextValue: LiffContextType = {
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
    <LiffContext value={contextValue}>
      <div className="flex flex-col min-h-screen">
        <main className={`flex-1 ${publicPath ? '' : 'pb-20'}`}>{children}</main>
        {!publicPath && <Footer />}
      </div>
    </LiffContext>
  );
}
