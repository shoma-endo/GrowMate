/**
 * サービス利用停止ページ
 * unavailableロールのユーザーがアクセスする
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UnavailablePage() {
  const router = useRouter();

  useEffect(() => {
    // ページロード時とその後定期的にユーザーロールを確認
    const checkUserRole = async () => {
      try {
        // キャッシュを避けるためにタイムスタンプを追加
        const response = await fetch(`/api/auth/check-role?t=${Date.now()}`);
        if (response.ok) {
          const data = await response.json();
          // unavailableユーザー以外はホーム画面にリダイレクト
          if (data.role !== 'unavailable') {
            router.push('/');
          }
        } else if (response.status === 409) {
          router.push('/login?reason=email_link_conflict');
        } else {
          // 認証エラーの場合はログインページへ
          router.push('/login');
        }
      } catch (error) {
        console.error('Role check failed:', error);
        router.push('/login');
      }
    };

    // 初回チェック
    checkUserRole();
    
    // 5秒ごとに権限をチェック（権限変更の即座反映のため）
    const interval = setInterval(checkUserRole, 5000);
    
    return () => clearInterval(interval);
  }, [router]);
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 text-red-400">
              <svg
                className="h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900 break-keep">
              サービス利用停止中
            </h2>
            <p className="mt-2 text-sm text-gray-600 text-center leading-relaxed">
              申し訳ございませんが、現在あなたのアカウントでは
              <br />
              サービスをご利用いただけません。
            </p>
            <div className="mt-6 bg-red-50 border border-red-200 rounded-md p-4 text-center">
              <h3 className="inline-flex items-center justify-center gap-2 text-sm font-medium text-red-800 break-keep">
                <svg
                  className="h-5 w-5 text-red-400 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                    clipRule="evenodd"
                  />
                </svg>
                アクセス制限について
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-red-700 break-keep">
                <li>チャット機能のご利用</li>
                <li>管理画面へのアクセス</li>
                <li>その他すべてのサービス機能</li>
              </ul>
            </div>
            <p className="mt-4 text-sm text-gray-500 text-center leading-relaxed">
              サービスの利用再開については、
              <br />
              管理者にお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}