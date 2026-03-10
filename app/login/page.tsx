'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [showButton, setShowButton] = useState(false);
  const hasAttemptedAutoLogin = useRef(false);

  const loginWithLine = async () => {
    setIsLoading(true);
    setShowButton(false);
    try {
      // サーバー側でセキュアなstate生成とCookie設定
      const response = await fetch('/api/auth/line-oauth-init', {
        cache: 'no-store', // キャッシュ無効化
      });

      if (!response.ok) {
        throw new Error(`OAuth init failed: ${response.status}`);
      }

      const { authUrl } = await response.json();

      // LINE OAuth認証ページへリダイレクト
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error('No authUrl received');
      }
    } catch (error) {
      console.error('[LoginPage] Login Error:', error);
      alert('ログイン処理中にエラーが発生しました。再試行してください。');
      setShowButton(true);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // 開発環境のStrict Modeでの二重実行防止
    if (hasAttemptedAutoLogin.current) {
      return;
    }
    hasAttemptedAutoLogin.current = true;

    const autoLogin = async () => {
      setIsLoading(true);

      try {
        // セッションチェック（キャッシュ無効化）
        const response = await fetch('/api/auth/check-role', {
          credentials: 'include',
          cache: 'no-store',
        });

        if (response.ok) {
          // router.replaceだと不安定な場合があるのでwindow.locationを使用
          window.location.href = '/';
          return;
        }

        if (response.status === 401) {
          // 未認証なら即座にLINEログインへ
          await loginWithLine();
          return;
        }

        // 401以外のエラー（500等）
        console.warn('[LoginPage] Unexpected status:', response.status);
        setShowButton(true);
        setIsLoading(false);
      } catch (error) {
        console.error('[LoginPage] Auto login check failed:', error);
        setShowButton(true);
        setIsLoading(false);
      }
    };

    autoLogin();
  }, [router]);

  return (
    <div className="flex h-full flex-col items-center justify-center pt-20 pb-10">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">ログイン</h1>

        {/* ローディングスピナー */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-[#06C755]" />
            <p className="text-gray-500">LINE認証画面へリダイレクトしています...</p>
          </div>
        )}

        {/* エラー時の手動ログインボタン */}
        {!isLoading && showButton && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
            <p className="text-red-500 text-sm">
              自動リダイレクトできませんでした。
              <br />
              以下のボタンからログインしてください。
            </p>
            <Button
              onClick={loginWithLine}
              size="lg"
              className="bg-[#06C755] text-white hover:bg-[#06C755] hover:opacity-90 active:opacity-70 px-8 py-6 text-lg rounded-xl shadow-md transition-all"
            >
              LINEでログイン
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
