'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { featureFlags } from '@/config/featureFlags';
import { sendOtpEmail, verifyOtp } from '@/server/actions/auth.actions';

type LoginView = 'loading' | 'options' | 'email-form' | 'otp-form';

export default function LoginPage() {
  const hasChecked = useRef(false);
  const [view, setView] = useState<LoginView>('loading');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isPending, startTransition] = useTransition();

  // セッション確認
  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    fetch('/api/auth/check-role', { credentials: 'include', cache: 'no-store' })
      .then(res => {
        if (res.ok) {
          window.location.href = '/';
        } else {
          setView('options');
        }
      })
      .catch(() => setView('options'));
  }, []);

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
      window.location.href = '/';
    });
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">ログイン</CardTitle>
          <CardDescription>LINE またはメール認証コードでログインできます</CardDescription>
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
              <Button
                onClick={loginWithLine}
                size="lg"
                className="w-full bg-[#06C755] text-white hover:bg-[#06C755] hover:opacity-90 active:opacity-70 px-8 py-6 text-lg rounded-xl shadow-md transition-all"
              >
                LINEでログイン
              </Button>

              {featureFlags.emailAuthEnabled && (
                <>
                  <div className="relative flex items-center">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="mx-3 text-sm text-gray-400">または</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>

                  <Button
                    onClick={() => {
                      setError('');
                      setView('email-form');
                    }}
                    variant="outline"
                    size="lg"
                    className="w-full px-8 py-6 text-lg rounded-xl"
                  >
                    メールでログイン
                  </Button>
                </>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {view === 'email-form' && (
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

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleSendOtp} disabled={isPending || !email} className="w-full">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '認証コードを送信'}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setError('');
                  setView('options');
                }}
                className="text-sm text-gray-400 underline w-full text-center"
              >
                戻る
              </button>
            </div>
          )}

          {view === 'otp-form' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4">
              <p className="text-sm text-gray-600">
                <span className="font-medium">{email}</span> に認証コードを送信しました。
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
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ログイン'}
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
                  setView('email-form');
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
  );
}
