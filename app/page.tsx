'use client';

import { useAuth } from '@/components/AuthProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';
import { updateUserFullName } from '@/server/actions/user.actions';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import Image from 'next/image';
import { Settings, Shield, List, Plug } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FullNameDialog } from '@/components/FullNameDialog';
import { hasPaidFeatureAccess } from '@/types/user';
import { isAdmin as isAdminRole } from '@/authUtils';
import { signOutEmail } from '@/server/actions/auth.actions';
import { toast } from 'sonner';

const LOGOUT_ERROR_MSG = 'ログアウトに失敗しました。再度お試しください。';

const ProfileDisplay = () => {
  const { isLoading, user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      const result = await signOutEmail();
      if (!result.success) {
        toast.error(result.error ?? LOGOUT_ERROR_MSG);
        return;
      }
      router.push('/login');
    } catch {
      toast.error(LOGOUT_ERROR_MSG);
    }
  };

  if (isLoading || !user) {
    return null;
  }

  const displayName = user.fullName ?? user.email ?? 'ユーザー';
  const pictureUrl = user?.linePictureUrl;

  return (
    <Card className="w-full max-w-md mb-6">
      <CardHeader>
        <CardTitle className="text-xl text-center">アカウント情報</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {pictureUrl && (
          <Avatar className="h-26 w-26 mb-6">
            <Image src={pictureUrl} alt={displayName} width={104} height={104} />
          </Avatar>
        )}
        <h3 className="text-xl font-bold mb-2">{displayName}</h3>
        {user.email && <p className="text-sm text-gray-600 mb-4">メールアドレス: {user.email}</p>}
        <Button
          onClick={handleLogout}
          variant="destructive"
          className="mt-4"
          aria-label="ログアウト"
          tabIndex={0}
        >
          ログアウト
        </Button>
      </CardContent>
    </Card>
  );
};

// 管理者向けカードコンポーネント（constパターン使用）
interface AdminAccessCardProps {
  isAdmin: boolean;
  hasAuthenticatedUser: boolean;
  isLoading: boolean;
}

const AdminAccessCard = ({ isAdmin, hasAuthenticatedUser, isLoading }: AdminAccessCardProps) => {
  if (isLoading || !hasAuthenticatedUser || !isAdmin) {
    return null;
  }

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2">
          <Shield className="h-6 w-6 text-blue-600" />
          管理者機能
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 text-center mb-4">
            管理者権限でログインしています。
            <br />
            管理者のみ編集/閲覧できます。
          </p>

          <Button
            asChild
            className="w-full bg-blue-600 hover:bg-blue-700"
            aria-label="管理者ダッシュボードへ移動"
            tabIndex={0}
          >
            <Link href="/admin">
              <Settings className="h-4 w-4" />
              管理者ダッシュボード
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default function Home() {
  const { isLoading, user } = useAuth();
  const hasAuthenticatedUser = Boolean(user);
  const userRole = user?.role ?? null;

  // フルネーム関連ステート
  const [showFullNameDialog, setShowFullNameDialog] = useState(false);

  const isAdmin = isAdminRole(userRole);
  const hasManagementAccess = hasPaidFeatureAccess(userRole);

  // フルネーム未入力チェック
  useEffect(() => {
    if (user && !user.fullName && !isLoading) {
      setShowFullNameDialog(true);
    }
  }, [user, isLoading]);

  const handleSaveFullName = async (fullName: string) => {
    try {
      const result = await updateUserFullName(fullName);
      if (result.success) {
        setShowFullNameDialog(false);
        window.location.reload();
      } else {
        throw new Error(result.error || 'フルネーム保存に失敗しました');
      }
    } catch (error) {
      console.error('フルネーム保存エラー:', error);
      throw error;
    }
  };

  return (
    <>
      <Toaster />
      <FullNameDialog open={showFullNameDialog} onSave={handleSaveFullName} />

      {!isLoading && hasAuthenticatedUser && (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 lg:p-8">
          <h1 className="text-3xl font-bold mb-8">GrowMate</h1>

          <ProfileDisplay />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full max-w-md lg:max-w-6xl">
            <AdminAccessCard
              isAdmin={isAdmin}
              hasAuthenticatedUser={hasAuthenticatedUser}
              isLoading={isLoading}
            />

            {/* 有料/管理者向け 設定ページ導線 */}
            {hasAuthenticatedUser && hasManagementAccess && (
              <Card className="">
                <CardHeader>
                  <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2 -ml-2">
                    <Settings className="h-5 w-5" />
                    設定
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 text-center mb-4">
                    WordPressやGoogle Search Consoleの
                    <br />
                    連携設定はこちらから
                  </p>
                  <Button asChild className="w-full" aria-label="設定ページへ移動" tabIndex={0}>
                    <Link href="/setup">設定を開く</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* 有料/管理者向け コンテンツ一覧導線 */}
            {hasAuthenticatedUser && hasManagementAccess && (
              <Card className="">
                <CardHeader>
                  <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2 -ml-2">
                    <List className="h-5 w-5" />
                    コンテンツ一覧
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 text-center mb-4">
                    WordPressとGoogle Search Consoleの
                    <br />
                    メタ情報を一覧表示します
                  </p>
                  <Button asChild className="w-full" aria-label="コンテンツ一覧へ移動" tabIndex={0}>
                    <Link href="/analytics">一覧を開く</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* 管理者向け Google Ads 分析導線 */}
            {isAdmin && (
              <Card className="border-indigo-200 bg-indigo-50">
                <CardHeader>
                  <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2">
                    <Plug className="h-5 w-5 text-indigo-600" />
                    Google Ads 分析
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-700 text-center mb-4">
                    広告キャンペーンのパフォーマンスを
                    <br />
                    確認・分析できます
                  </p>
                  <Button
                    asChild
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                    aria-label="Google Ads ダッシュボードへ移動"
                    tabIndex={0}
                  >
                    <Link href="/google-ads-dashboard">
                      ダッシュボードを開く
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
