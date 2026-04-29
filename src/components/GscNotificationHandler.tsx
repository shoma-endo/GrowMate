'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getUnreadSuggestionsCount } from '@/server/actions/gscNotification.actions';

const TOAST_SESSION_KEY = 'gsc_notification_toast_shown';
const UNREAD_EVENT = 'gsc-unread-updated';

export function GscNotificationHandler() {
  const { isLoggedIn, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toastShownRef = useRef(false);
  const toastIdRef = useRef<string | number | null>(null);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  // 一般ユーザー向けページでは通知を表示しない
  const isPublicPage = !!pathname
    ? pathname === '/home' || pathname === '/privacy'
    : false;

  const showToast = useCallback(
    (count: number) => {
      // 0件なら既存トーストを閉じる
      if (count <= 0) {
        if (toastIdRef.current) {
          toast.dismiss(toastIdRef.current);
          toastIdRef.current = null;
        }
        return;
      }

      // 既存トーストを差し替え
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }

      const id = toast.custom(
        t => (
          <div
            className="relative flex items-center gap-4 w-auto max-w-lg p-4 bg-amber-50 border border-amber-200 rounded-lg shadow-lg shadow-amber-900/5 cursor-pointer hover:bg-amber-100 transition-all duration-200 overflow-hidden"
            onClick={() => {
              toast.dismiss(t);
              router.push('/analytics?unread_suggestion=1');
            }}
          >
            {/* 左端のアクセントバー */}
            <div className="absolute inset-y-0 left-0 w-1 bg-amber-500" />

            <div className="flex-shrink-0 ml-2">
              <span className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-white text-amber-600 shadow-sm ring-1 ring-amber-100">
                <Bell className="h-5 w-5" />
              </span>
            </div>
            
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-sm font-bold text-amber-900 whitespace-nowrap">
                {count}件の改善提案があります
              </p>
              <p className="text-xs text-amber-700 mt-1 opacity-90 whitespace-nowrap">
                クリックしてコンテンツ一覧で確認
              </p>
            </div>

            <button
              className="absolute top-2 right-2 p-1.5 text-amber-900/40 hover:text-amber-900 hover:bg-amber-900/10 rounded-full transition-colors"
              onClick={e => {
                e.stopPropagation();
                toast.dismiss(t);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ),
        {
          duration: Infinity,
        }
      );

      toastIdRef.current = id;
      toastShownRef.current = true;
      sessionStorage.setItem(TOAST_SESSION_KEY, 'true');
    },
    [router]
  );

  const fetchUnread = useCallback(async () => {
    if (!isLoggedIn || isLoading || isPublicPage) return;

    try {
      const result = await getUnreadSuggestionsCount();
      setUnreadCount(result.count);
      // セッション中に一度だけトースト表示
      if (result.count > 0 && !toastShownRef.current) {
        const alreadyShown = sessionStorage.getItem(TOAST_SESSION_KEY);
        if (!alreadyShown) {
          showToast(result.count);
        }
      } else if (result.count === 0) {
        showToast(0);
      }
    } catch (error) {
      console.error('Failed to fetch unread suggestions', error);
    }
  }, [isLoggedIn, isLoading, isPublicPage, showToast]);

  // 初回マウント時と画面遷移時に再取得
  useEffect(() => {
    fetchUnread();
  }, [fetchUnread, pathname]);

  // ログアウト時またはパブリックページ遷移時にリセット
  useEffect(() => {
    if ((!isLoggedIn && !isLoading) || isPublicPage) {
      toastShownRef.current = false;
      sessionStorage.removeItem(TOAST_SESSION_KEY);
      setUnreadCount(null);
      showToast(0);
    }
  }, [isLoggedIn, isLoading, isPublicPage, showToast]);

  // 履歴タブなどで既読にされた際の通知を受けてカウント更新
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ delta?: number; count?: number }>;
      setUnreadCount(prev => {
        const current = prev ?? 0;
        const next =
          typeof custom.detail?.count === 'number'
            ? custom.detail.count
            : current + (custom.detail?.delta ?? 0);
        return next < 0 ? 0 : next;
      });
    };
    window.addEventListener(UNREAD_EVENT, handler);
    return () => window.removeEventListener(UNREAD_EVENT, handler);
  }, []);

  // カウントが更新されたらトーストを反映
  useEffect(() => {
    if (unreadCount == null) return;
    showToast(unreadCount);
  }, [unreadCount, showToast]);

  // このコンポーネントはUIを持たない（Faviconバッジとトーストのみ）
  return null;
}
