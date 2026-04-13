import { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldX, Home } from 'lucide-react';
import Link from 'next/link';
import { getRoleDisplayName } from '@/authUtils';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import type { UserRole } from '@/types/user';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'アクセス権限なし | GrowMate',
  description: 'このページにアクセスするための権限がありません。',
  robots: 'noindex, nofollow',
};

export default async function UnauthorizedPage() {
  // 現在のユーザー情報を取得（表示用）
  let currentUserRole: UserRole | null = null;

  try {
    const authResult = await authMiddleware();
    if (!authResult.error) {
      currentUserRole = authResult.userDetails?.role ?? null;
    }
  } catch (error) {
    console.warn('Failed to get user role for display:', error);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* メインカード */}
        <Card className="text-center border-red-200 dark:border-red-800">
          <CardHeader className="pb-4">
            {/* アイコン */}
            <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldX size={40} className="text-red-600 dark:text-red-400" aria-hidden="true" />
            </div>

            {/* タイトル */}
            <CardTitle className="text-xl text-red-700 dark:text-red-300">
              アクセス権限がありません
            </CardTitle>

            {/* 説明 */}
            <CardDescription className="text-base">
              このページにアクセスするには管理者権限が必要です。
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* 現在の権限表示 */}
            {currentUserRole && (
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">現在の権限:</div>
                <Badge variant={currentUserRole === 'admin' ? 'default' : 'outline'} className="text-sm">
                  {getRoleDisplayName(currentUserRole)}
                </Badge>
              </div>
            )}

            {/* アクションボタン */}
            <div className="flex flex-col gap-3">
              <Button asChild className="w-full">
                <Link href="/" className="flex items-center justify-center gap-2">
                  <Home size={16} />
                  ホームに戻る
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
