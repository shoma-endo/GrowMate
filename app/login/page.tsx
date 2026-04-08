'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Loader2 } from 'lucide-react';

import {
  LINE_OAUTH_CALLBACK_MESSAGES,
  LINE_OAUTH_CALLBACK_QUERY_PARAM,
} from '@/domain/lineOauthCallbackErrors';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendOtpEmail, verifyOtp, registerFullName } from '@/server/actions/auth.actions';
import { FullNameDialog } from '@/components/FullNameDialog';

type LoginView = 'loading' | 'options' | 'otp-form';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<LoginView>('options');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [showFullNameDialog, setShowFullNameDialog] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isPending, startTransition] = useTransition();

  // LINE OAuth コールバック失敗時のクエリ（生 JSON を避けて /login に誘導した場合）
  useEffect(() => {
    const code = searchParams?.get(LINE_OAUTH_CALLBACK_QUERY_PARAM);
    if (!code) return;
    const message =
      code in LINE_OAUTH_CALLBACK_MESSAGES
        ? LINE_OAUTH_CALLBACK_MESSAGES[code as keyof typeof LINE_OAUTH_CALLBACK_MESSAGES]
        : LINE_OAUTH_CALLBACK_MESSAGES.unexpected;
    setError(message);
    setView('options');
    router.replace('/login', { scroll: false });
  }, [router, searchParams]);

  // 再送信カウントダウン
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const loginWithLine = async () => {
    setView('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/line-oauth-init', { cache: 'no-store' });
      if (!res.ok) throw new Error(`OAuth init failed: ${res.status}`);
      const { authUrl } = await res.json();
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        throw new Error('No authUrl received');
      }
    } catch (err) {
      console.error('[LoginPage] LINE login error:', err);
      setError('ログイン処理中にエラーが発生しました。再試行してください。');
      setView('options');
    }
  };

  const handleSendOtp = () => {
    if (!email) return;
    setError('');
    startTransition(async () => {
      const result = await sendOtpEmail(email);
      if (!result.success) {
        setError(result.error ?? 'エラーが発生しました');
        return;
      }
      setResendCooldown(60);
      setView('otp-form');
    });
  };

  const handleVerifyOtp = () => {
    if (otp.length !== 6) return;
    setError('');
    startTransition(async () => {
      const result = await verifyOtp(email, otp);
      if (!result.success) {
        setError(result.error ?? 'エラーが発生しました');
        return;
      }
      // LIFF の localStorage キャッシュを削除する。
      // 以前に LINE ログインした場合、LIFF SDK が isLoggedIn=true をキャッシュしており、
      // リダイレクト後に syncWithServerIfNeeded() が古い LINE トークンで /api/user/current を
      // 呼び出してしまい、Email ユーザーが LINE ユーザーとして認証される問題を防ぐ。
      if (typeof window !== 'undefined') {
        // 外部ブラウザは localStorage、LIFF in-client は sessionStorage を使うため両方をクリア
        for (const storage of [localStorage, sessionStorage]) {
          const keysToRemove: string[] = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith('LIFF_STORE:')) keysToRemove.push(key);
          }
          keysToRemove.forEach(key => storage.removeItem(key));
        }
      }
      if (result.isNewUser) {
        setShowFullNameDialog(true);
      } else {
        window.location.href = '/';
      }
    });
  };

  const handleSaveFullName = async (fullName: string) => {
    const result = await registerFullName(fullName);
    if (!result.success) {
      throw new Error(result.error ?? 'フルネーム保存に失敗しました');
    }
    window.location.href = '/';
  };

  const handleResend = () => {
    if (resendCooldown > 0 || isPending) return;
    setError('');
    startTransition(async () => {
      const result = await sendOtpEmail(email);
      if (!result.success) {
        setError(result.error ?? 'エラーが発生しました');
        return;
      }
      setResendCooldown(60);
    });
  };

  return (
    <>
    <FullNameDialog open={showFullNameDialog} onSave={handleSaveFullName} />
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <h1 className="text-3xl font-bold mb-6">ログイン</h1>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {view === 'options' && (
            <>
              <CardDescription>LINE またはメールでログインできます</CardDescription>
              <p className="text-sm text-gray-500 mt-2">初めての方もご利用いただけます</p>
            </>
          )}
          {view === 'otp-form' && (
            <CardDescription>認証コードを入力してください</CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {view === 'loading' && (
            <div className="flex flex-col items-center justify-center space-y-4 py-4">
              <Loader2 className="h-10 w-10 animate-spin text-[#06C755]" />
              <p className="text-gray-500">確認中...</p>
            </div>
          )}

          {view === 'options' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={isPending}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSendOtp();
                  }}
                />
              </div>

              <Button onClick={handleSendOtp} disabled={isPending || !email} className="w-full">
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    送信中...
                  </>
                ) : (
                  '認証コードを送信'
                )}
              </Button>

              <div className="relative flex items-center">
                <div className="flex-1 border-t border-gray-200" />
                <span className="mx-3 text-sm text-gray-400">または</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              <Button
                onClick={loginWithLine}
                size="lg"
                className="w-full bg-[#06C755] text-white hover:opacity-90 active:opacity-70 px-8 py-6 text-lg rounded-xl shadow-md transition-all"
              >
                LINEでログイン
              </Button>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {view === 'otp-form' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{email}</span> に認証コードを送信しました。
              </p>
              <p className="text-xs text-gray-400">
                メールが届かない場合は、迷惑メールフォルダをご確認ください。
              </p>

              <div className="space-y-2">
                <Label htmlFor="otp">認証コード（6桁）</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  disabled={isPending}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleVerifyOtp();
                  }}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleVerifyOtp}
                disabled={isPending || otp.length !== 6}
                className="w-full"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    確認中...
                  </>
                ) : (
                  'ログイン'
                )}
              </Button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || isPending}
                className="text-sm text-gray-400 underline w-full text-center disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resendCooldown > 0 ? `再送信（${resendCooldown}秒後）` : '認証コードを再送信'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError('');
                  setOtp('');
                  setView('options');
                }}
                className="text-sm text-gray-400 underline w-full text-center"
              >
                メールアドレスを変更する
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <Loader2 className="h-10 w-10 animate-spin text-[#06C755]" />
          <p className="mt-4 text-sm text-gray-500">読み込み中...</p>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
