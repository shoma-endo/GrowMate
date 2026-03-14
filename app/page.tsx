'use client';

import { useLiffContext } from '@/components/LiffProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { useState, useEffect } from 'react';
import { updateUserFullName } from '@/server/actions/user.actions';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import Image from 'next/image';
import { Settings, Shield, List, UserPlus, UserX, Plug } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FullNameDialog } from '@/components/FullNameDialog';
import { hasPaidFeatureAccess } from '@/types/user';
import { InviteDialog } from '@/components/InviteDialog';
import { canInviteEmployee, hasOwnerRole, isAdmin as isAdminRole } from '@/authUtils';
import { signOutEmail } from '@/server/actions/auth.actions';
import { toast } from 'sonner';

interface EmployeeInfo {
  id: string;
  lineDisplayName: string;
  linePictureUrl?: string;
  createdAt: string;
}

const LOGOUT_ERROR_MSG = 'ログアウトに失敗しました。再度お試しください。';

const ProfileDisplay = () => {
  const { profile, isLoading, isLoggedIn, logout, user, isOwnerViewMode } = useLiffContext();
  const router = useRouter();

  const handleLogout = async () => {
    const isLineUser = isLoggedIn;
    try {
      const result = await signOutEmail(
        isLineUser ? { allowPartialOnTransientError: true } : undefined
      );
      if (!result.success) {
        toast.error(result.error ?? LOGOUT_ERROR_MSG);
        return;
      }
      if (result.partial) {
        toast.info(
          'LINE からはログアウトしました。再度ログインしたように見える場合は、もう一度ログアウトを押してください。'
        );
      }
      if (isLineUser) {
        logout();
      } else {
        router.push('/login');
      }
    } catch {
      toast.error(LOGOUT_ERROR_MSG);
    }
  };

  if (isLoading || !user) {
    return null;
  }

  const displayName =
    user.fullName ??
    (isOwnerViewMode ? user.lineDisplayName : profile?.displayName) ??
    user.email ??
    'ユーザー';
  const pictureUrl = user?.linePictureUrl ?? profile?.pictureUrl;
  const userId = user.id;

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
        {user.email && <p className="text-sm text-gray-600">メールアドレス: {user.email}</p>}
        <p className="text-sm text-gray-600 mb-4">ユーザーID: {userId}</p>
        {!isOwnerViewMode && !!user && (
          <button
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm"
            aria-label="ログアウト"
            tabIndex={0}
          >
            ログアウト
          </button>
        )}
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

interface EmployeeInviteCardProps {
  canInvite: boolean;
  hasAuthenticatedUser: boolean;
  isLoading: boolean;
}

const EmployeeInviteCard = ({
  canInvite,
  hasAuthenticatedUser,
  isLoading,
}: EmployeeInviteCardProps) => {
  if (isLoading || !hasAuthenticatedUser || !canInvite) {
    return null;
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2">
          <UserPlus className="h-5 w-5 text-emerald-600" />
          スタッフ招待
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-700 text-center mb-4">
          招待リンクを発行して
          <br />
          スタッフを招待できます。
        </p>
        <div className="flex justify-center w-full">
          <InviteDialog
            trigger={
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md transition-colors"
                aria-label="招待ダイアログを開く"
              >
                <UserPlus className="mr-2 h-5 w-5" />
                スタッフを招待する
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
};

interface OwnerEmployeeCardProps {
  isOwnerRole: boolean;
  hasAuthenticatedUser: boolean;
  isLoading: boolean;
}

const OwnerEmployeeCard = ({
  isOwnerRole,
  hasAuthenticatedUser,
  isLoading,
}: OwnerEmployeeCardProps) => {
  const { getAccessToken } = useLiffContext();
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!isOwnerRole || !hasAuthenticatedUser) return;

    const fetchEmployee = async () => {
      setFetching(true);
      try {
        const accessToken = await getAccessToken();
        const res = await fetch('/api/employee', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!res.ok) {
          throw new Error('スタッフ情報の取得に失敗しました');
        }

        const data = await res.json();
        setEmployee(data.employee ?? null);
      } catch (error) {
        console.error('Failed to fetch employee:', error);
        toast.error('スタッフ情報の取得に失敗しました');
      } finally {
        setFetching(false);
      }
    };

    void fetchEmployee();
  }, [getAccessToken, hasAuthenticatedUser, isOwnerRole]);

  if (isLoading || !hasAuthenticatedUser || !isOwnerRole) {
    return null;
  }

  const enterViewMode = () => {
    if (!employee) {
      return;
    }
    // Secure フラグは HTTPS 接続時のみ追加
    const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const secureFlag = isSecure ? '; secure' : '';
    const cookieOptions = `path=/; samesite=lax; max-age=3600${secureFlag}`; // 1時間の有効期限
    document.cookie = `owner_view_mode=1; ${cookieOptions}`;
    document.cookie = `owner_view_mode_employee_id=${employee.id}; ${cookieOptions}`;
    router.push('/chat');
  };

  return (
    <>
      <Card className="border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-center flex items-center justify-center gap-2">
            <UserPlus className="h-5 w-5 text-amber-600" />
            スタッフ管理
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fetching ? (
            <div className="text-center py-4">読み込み中...</div>
          ) : employee ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={enterViewMode}
                className="w-full text-left p-4 bg-white rounded-lg flex items-center gap-3 hover:bg-amber-100 transition-colors"
                aria-label="スタッフ画面を閲覧"
              >
                {employee.linePictureUrl ? (
                  <Image
                    src={employee.linePictureUrl}
                    alt="Avatar"
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-gray-500 text-xs">No Img</span>
                  </div>
                )}
                <div>
                  <p className="font-medium text-sm">{employee.lineDisplayName}</p>
                  <p className="text-xs text-gray-500">
                    登録日: {new Date(employee.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </button>
              <div className="flex justify-end">
                <InviteDialog
                  onEmployeeDeleted={() => setEmployee(null)}
                  defaultOpenMode="delete"
                  trigger={
                    <Button variant="destructive" size="sm" className="gap-2">
                      <UserX className="h-4 w-4" />
                      スタッフを削除
                    </Button>
                  }
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 text-center">現在スタッフは登録されていません。</p>
          )}
        </CardContent>
      </Card>
    </>
  );
};

export default function Home() {
  const { isLoading, isLoggedIn, user, isOwnerViewMode } = useLiffContext();
  const hasAuthenticatedUser = Boolean(user);
  const userRole = user?.role ?? null;
  const isRoleLoading = !isLoading && !hasAuthenticatedUser;
  const isStaffUser = Boolean(user?.ownerUserId);

  // フルネーム関連ステート
  const [showFullNameDialog, setShowFullNameDialog] = useState(false);

  const isAdmin = isAdminRole(userRole);
  const isOwnerRole = hasOwnerRole(userRole);
  const hasManagementAccess = hasPaidFeatureAccess(userRole);
  const canManageIntegrations =
    !isOwnerViewMode && !isStaffUser && (isOwnerRole || hasManagementAccess);
  const canInvite = !isOwnerViewMode && !isStaffUser && canInviteEmployee(userRole);

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
              isLoading={isLoading || isRoleLoading}
            />
            <EmployeeInviteCard
              canInvite={canInvite}
              hasAuthenticatedUser={hasAuthenticatedUser}
              isLoading={isLoading || isRoleLoading}
            />
            <OwnerEmployeeCard
              isOwnerRole={isOwnerRole}
              hasAuthenticatedUser={hasAuthenticatedUser}
              isLoading={isLoading || isRoleLoading}
            />

            {/* 有料/管理者向け 設定ページ導線 */}
            {hasAuthenticatedUser && canManageIntegrations && !isRoleLoading && (
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
            {hasAuthenticatedUser && hasManagementAccess && !isRoleLoading && (
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
            {isAdmin && !isRoleLoading && (
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
