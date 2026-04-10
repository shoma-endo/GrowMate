'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Loader2 } from 'lucide-react';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendOtpEmail, signOutEmail, verifyOtp, registerFullName } from '@/server/actions/auth.actions';
import { FullNameDialog } from '@/components/FullNameDialog';

type LoginView = 'options' | 'otp-form';

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

  // reason クエリ単体では競合とみなさない（ブックマーク誤表示防止）。409 が返ったときのみ表示し、セッションはそのとき best-effort で破棄。
  useEffect(() => {
    if (searchParams?.get('reason') !== 'email_link_conflict') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/user/current', { credentials: 'include', cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 409) {
          setError(ERROR_MESSAGES.AUTH.EMAIL_LINK_CONFLICT);
          void signOutEmail().catch(() => {
            /* Supabase セッション解除は best effort */
          });
          return;
        }
        router.replace('/login');
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  // 再送信カウントダウン
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

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
              <CardDescription>メールでログインできます</CardDescription>
              <p className="text-sm text-gray-500 mt-2">初めての方もご利用いただけます</p>
            </>
          )}
          {view === 'otp-form' && (
            <CardDescription>認証コードを入力してください</CardDescription>
          )}
        </CardHeader>

        <CardContent>
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
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-gray-500">読み込み中...</p>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
