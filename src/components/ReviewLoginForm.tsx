'use client';

import { useState, useTransition } from 'react';

import { Loader2 } from 'lucide-react';

import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registerFullName, signInWithReviewPassword } from '@/server/actions/auth.actions';
import { FullNameDialog } from '@/components/FullNameDialog';

/**
 * Meta App Review のレビュアー専用ログインフォーム。
 * 通常の /login からは辿れない。ラベルは英語を併記する（レビュアーは日本語話者とは限らない）。
 */
export function ReviewLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showFullNameDialog, setShowFullNameDialog] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await signInWithReviewPassword(email, password);
      if (!result.success) {
        setError(result.error ?? '');
        return;
      }
      // full_name 未登録のまま '/' へ送ると proxy.ts が /login（OTP 画面）へ戻してしまい、
      // レビュアーは OTP を受け取れず詰む。この画面に留めて登録させる。
      if (result.isNewUser) {
        setShowFullNameDialog(true);
        return;
      }
      // OTP 経路と同じく、middleware にロール判定をさせるためフルリロードで遷移する
      window.location.href = '/';
    });
  };

  const handleSaveFullName = async (fullName: string) => {
    const result = await registerFullName(fullName);
    if (!result.success) {
      throw new Error(result.error ?? ERROR_MESSAGES.AUTH.REVIEW_LOGIN_FAILED);
    }
    window.location.href = result.nextPath ?? '/';
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl font-semibold">審査用ログイン / Reviewer sign-in</h1>
        </CardTitle>
        <CardDescription>
          Meta App Review のレビュアー専用の入口です。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="review-email">メールアドレス / Email</Label>
            <Input
              id="review-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-password">パスワード / Password</Label>
            <Input
              id="review-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={isPending}
            />
          </div>

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            ログイン / Sign in
          </Button>
        </form>
      </CardContent>
      <FullNameDialog open={showFullNameDialog} onSave={handleSaveFullName} />
    </Card>
  );
}
