"use client"

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { signOutEmail } from '@/server/actions/auth.actions';

interface FullNameDialogProps {
  open: boolean;
  onSave: (fullName: string) => Promise<void>;
}

export const FullNameDialog = ({ open, onSave }: FullNameDialogProps) => {
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!fullName.trim() || isLoading || isSigningOut) {
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await onSave(fullName.trim());
      setFullName('');
    } catch (err) {
      console.error('フルネーム保存エラー:', err);
      setError(err instanceof Error ? err.message : 'フルネームの保存に失敗しました。再度お試しください。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRelogin = async () => {
    if (isLoading || isSigningOut) return;
    setIsSigningOut(true);
    setError('');
    try {
      const result = await signOutEmail();
      if (!result.success) {
        setError(result.error ?? 'ログアウトに失敗しました。再度お試しください。');
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      console.error('再ログインのためのサインアウトエラー:', err);
      setError(err instanceof Error ? err.message : 'ログアウトに失敗しました。再度お試しください。');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 日本語IMEの変換確定 Enter では保存しない
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md max-h-[90vh] overflow-y-auto"
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>フルネームを入力してください</DialogTitle>
          <DialogDescription>
            サービスを利用するためにフルネームの入力が必要です。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="山田 太郎"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isSigningOut}
            required
            autoFocus
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            onClick={handleSave}
            disabled={!fullName.trim() || isLoading || isSigningOut}
            className="w-full"
          >
            {isLoading ? '保存中...' : '保存'}
          </Button>
          {error && (
            <Button
              type="button"
              variant="outline"
              onClick={handleRelogin}
              disabled={isLoading || isSigningOut}
              className="w-full"
            >
              {isSigningOut ? '移動中...' : '再ログインする'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
