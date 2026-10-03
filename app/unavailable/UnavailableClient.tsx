/**
 * unavailable ロールのユーザーが送られるページ。
 * 新規登録直後は unavailable で作られ、管理者が承認するまでここに留まるため、文言は承認待ちの案内にしている。
 * 管理者が利用停止にしたユーザーも同じ画面に来る（ロールだけでは区別できない）。
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';

export default function UnavailableClient() {
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
    <div className="min-h-screen bg-muted flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="text-center">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground" aria-hidden="true" />
            <h2 className="mt-6 text-3xl font-extrabold text-foreground break-keep">
              アカウントの承認待ち
            </h2>
            <p className="mt-2 text-sm text-muted-foreground text-center leading-relaxed">
              ご登録ありがとうございます。
              <br />
              管理者がアカウントを確認しています。
              <br />
              承認まで今しばらくお待ちください。
            </p>
            <div className="mt-6 bg-card border border-border rounded-md p-4 text-center">
              <h3 className="text-sm font-medium text-foreground break-keep">
                ご利用開始までの流れ
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground break-keep">
                <li>ご登録から72時間以内に承認します。</li>
                <li>承認されると、この画面は自動で切り替わります。</li>
                <li>
                  画面を閉じた場合は、
                  <br />
                  承認後にもう一度{' '}
                  <span className="whitespace-nowrap">GrowMate を開いてください。</span>
                </li>
              </ul>
            </div>
            <p className="mt-4 text-sm text-muted-foreground text-center leading-relaxed">
              72時間を過ぎても承認されない場合は、
              <br />
              管理者にお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
