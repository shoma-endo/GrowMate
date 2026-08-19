'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { getUnreadSuggestionsCount } from '@/server/actions/gscNotification.actions';

const LEGACY_TOAST_SESSION_KEYS = [
  'gsc_notification_toast_dismissed',
  'gsc_notification_toast_shown',
] as const;
const TOAST_ID = 'gsc-unread-suggestions';
const UNREAD_EVENT = 'gsc-unread-updated';

export function GscNotificationHandler() {
  const { isLoggedIn, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const dismissedRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  // 一般ユーザー向けページでは通知を表示しない
  const isPublicPage = !!pathname
    ? pathname === '/home' || pathname === '/privacy'
    : false;

  // 旧実装の sessionStorage フラグはリロード後も残るため、起動時に除去する
  useEffect(() => {
    for (const key of LEGACY_TOAST_SESSION_KEYS) {
      sessionStorage.removeItem(key);
    }
  }, []);

  const dismissToast = useCallback((rememberDismiss = false) => {
    toast.dismiss(TOAST_ID);
    if (rememberDismiss) {
      dismissedRef.current = true;
    }
  }, []);

  const showToast = useCallback(
    (count: number) => {
      if (count <= 0) {
        dismissToast(false);
        return;
      }

      if (dismissedRef.current) {
        return;
      }

      toast.custom(
        () => (
          <div
            className="relative flex items-center gap-4 w-auto max-w-lg p-4 bg-amber-50 border border-amber-200 rounded-lg shadow-lg shadow-amber-900/5 cursor-pointer hover:bg-amber-100 transition-all duration-200 overflow-hidden"
            onClick={() => {
              dismissToast(true);
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
                {count}件のコンテンツに改善提案があります
              </p>
              <p className="text-xs text-amber-700 opacity-90 whitespace-nowrap">
                クリックしてコンテンツ一覧で確認
              </p>
            </div>

            <button
              className="absolute top-2 right-2 p-1.5 text-amber-900/40 hover:text-amber-900 hover:bg-amber-900/10 rounded-full transition-colors"
              onClick={e => {
                e.stopPropagation();
                dismissToast(true);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ),
        {
          id: TOAST_ID,
          duration: Infinity,
        }
      );
    },
    [dismissToast, router]
  );

  const fetchUnread = useCallback(async () => {
    if (!isLoggedIn || isLoading || isPublicPage) return;

    try {
      const result = await getUnreadSuggestionsCount();
      setUnreadCount(result.count);
    } catch (error) {
      console.error('Failed to fetch unread suggestions', error);
    }
  }, [isLoggedIn, isLoading, isPublicPage]);

  // 初回マウント時と画面遷移時に再取得
  useEffect(() => {
    fetchUnread();
  }, [fetchUnread, pathname]);

  // ログアウト時またはパブリックページ遷移時にリセット
  useEffect(() => {
    if ((!isLoggedIn && !isLoading) || isPublicPage) {
      dismissedRef.current = false;
      setUnreadCount(null);
      dismissToast(false);
    }
  }, [isLoggedIn, isLoading, isPublicPage, dismissToast]);

  // 履歴タブなどで既読にされた際はサーバーから件数を再取得（履歴行数と記事数が一致しないため）
  useEffect(() => {
    const handler = () => {
      void fetchUnread();
    };
    window.addEventListener(UNREAD_EVENT, handler);
    return () => window.removeEventListener(UNREAD_EVENT, handler);
  }, [fetchUnread]);

  // カウントが更新されたらトーストを反映（固定 id で重複防止）
  useEffect(() => {
    if (unreadCount == null) return;
    showToast(unreadCount);
  }, [unreadCount, showToast]);

  // このコンポーネントはUIを持たない（Faviconバッジとトーストのみ）
  return null;
}
