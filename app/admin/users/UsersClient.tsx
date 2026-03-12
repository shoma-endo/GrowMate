'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAllUsers, updateUserRole } from '@/server/actions/admin.actions';
import { getRoleDisplayName } from '@/authUtils';
import type { User, UserRole } from '@/types/user';
import { clearAuthCache } from '@/server/actions/adminUsers.actions';
import { toast } from 'sonner';
import { formatDateTimeWithSeconds } from '@/lib/date-utils';

const getRoleColor = (role: UserRole | null) => {
  switch (role) {
    case 'admin':
      return 'bg-blue-100 text-blue-800';
    case 'trial':
      return 'bg-yellow-100 text-yellow-800';
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'owner':
      return 'bg-purple-100 text-purple-800';
    case 'unavailable':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const buildRoleSummary = (targetUsers: User[]) => {
  type RoleCount = {
    key: UserRole | 'unknown';
    label: string;
    count: number;
  };

  const baseRoles: UserRole[] = ['admin', 'paid', 'trial', 'owner', 'unavailable'];
  const counts: Record<UserRole, number> = {
    admin: 0,
    paid: 0,
    trial: 0,
    unavailable: 0,
    owner: 0,
  };
  let unknown = 0;

  targetUsers.forEach(user => {
    const role = user.role;
    if (role && role in counts) {
      counts[role] += 1;
    } else {
      unknown += 1;
    }
  });

  const summary: RoleCount[] = baseRoles.map(role => ({
    key: role,
    label: getRoleDisplayName(role),
    count: counts[role],
  }));

  if (unknown > 0) {
    summary.push({
      key: 'unknown',
      label: getRoleDisplayName(null),
      count: unknown,
    });
  }

  return summary;
};

type UsersClientProps = {
  initialUsers: User[];
};

export default function UsersClient({ initialUsers }: UsersClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    if (!userId || !newRole) return;

    setUpdatingUserId(userId);

    try {
      const result = await updateUserRole(userId, newRole);
      if (result.success) {
        // ローカル状態を更新
        setUsers(prevUsers =>
          prevUsers.map(user => (user.id === userId ? { ...user, role: newRole } : user))
        );
        setEditingUserId(null);

        // 成功フィードバックを表示
        toast.success('ユーザー権限を更新しました');

        // キャッシュクリア通知を送信（権限変更の即座反映のため）
        try {
          await clearAuthCache();
        } catch (cacheError) {
          console.warn('キャッシュクリアに失敗しました:', cacheError);
          toast.warning('権限を更新しましたが、キャッシュのクリアに失敗しました', {
            description: '権限の反映に時間がかかる可能性があります',
          });
        }
      } else {
        toast.error('権限の更新に失敗しました', {
          description: result.error || 'ユーザー権限の更新に失敗しました',
        });
      }
    } catch (error) {
      console.error('ユーザー権限更新エラー:', error);
      toast.error('権限の更新でエラーが発生しました', {
        description: 'ユーザー権限の更新中にエラーが発生しました',
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const staffUsers = useMemo(() => users.filter(user => !!user.ownerUserId), [users]);
  const nonStaffUsers = useMemo(() => users.filter(user => !user.ownerUserId), [users]);
  const ownerById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);

  const roleSummary = useMemo(() => {
    return buildRoleSummary(nonStaffUsers);
  }, [nonStaffUsers]);

  const staffRoleSummary = useMemo(() => {
    return buildRoleSummary(staffUsers);
  }, [staffUsers]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">ユーザー管理</h1>
        </div>
        <div className="text-center py-8">
          <p>ユーザー一覧を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">ユーザー管理</h1>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-red-600">
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">ユーザー管理</h1>
          <p className="mt-2 text-gray-600">
            登録済みユーザーの一覧を表示します（合計: {nonStaffUsers.length}人 / スタッフ: {staffUsers.length}人）
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-500">
            {roleSummary.map(({ key, label, count }) => (
              <span
                key={key}
                className={`px-2 py-1 text-xs rounded-full ${getRoleColor(
                  key === 'unknown' ? null : key
                )}`}
              >
                {label}: {count}人
              </span>
            ))}
          </div>
        </div>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">ユーザー</TabsTrigger>
          <TabsTrigger value="staff">スタッフ</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>ユーザー一覧</CardTitle>
            </CardHeader>
            <CardContent>
              {nonStaffUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>登録済みユーザーがいません</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          フルネーム
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          LINE表示名
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          メールアドレス / 認証方式
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          最終ログイン
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          登録日
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          権限
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          アクション
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {nonStaffUsers.map(user => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {user.fullName || '未入力'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {user.lineDisplayName || '—'}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            <div className="flex flex-col gap-1">
                              {user.email && (
                                <span className="text-xs text-gray-700">{user.email}</span>
                              )}
                              <div className="flex gap-1">
                                {user.lineUserId && (
                                  <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
                                    LINE
                                  </span>
                                )}
                                {user.supabaseAuthId && (
                                  <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-700">
                                    メール
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDateTimeWithSeconds(user.lastLoginAt, '未ログイン')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDateTimeWithSeconds(user.createdAt, '登録日不明')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {editingUserId === user.id ? (
                              <Select
                                value={user.role ?? 'unavailable'}
                                onValueChange={value =>
                                  handleRoleChange(user.id, value as UserRole)
                                }
                                disabled={updatingUserId === user.id}
                              >
                                <SelectTrigger size="sm" className="w-40 text-xs">
                                  <SelectValue placeholder="権限を選択" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="trial">お試しユーザー</SelectItem>
                                  <SelectItem value="paid">有料契約ユーザー</SelectItem>
                                  <SelectItem value="admin">管理者</SelectItem>
                                  <SelectItem value="unavailable">サービス利用停止</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span
                                className={`px-2 py-1 text-xs rounded-full ${getRoleColor(
                                  user.role
                                )}`}
                              >
                                {getRoleDisplayName(user.role)}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {editingUserId === user.id ? (
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => setEditingUserId(null)}
                                  className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
                                  disabled={updatingUserId === user.id}
                                >
                                  キャンセル
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingUserId(user.id)}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                編集
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="staff">
          <Card>
            <CardHeader>
              <CardTitle>スタッフ一覧</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                スタッフとして登録されたユーザー（合計: {staffUsers.length}人）
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-500">
                {staffRoleSummary.map(({ key, label, count }) => (
                  <span
                    key={key}
                    className={`px-2 py-1 text-xs rounded-full ${getRoleColor(
                      key === 'unknown' ? null : key
                    )}`}
                  >
                    {label}: {count}人
                  </span>
                ))}
              </div>

              {staffUsers.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>スタッフ登録ユーザーがいません</p>
                </div>
              ) : (
                <div className="overflow-x-auto mt-4">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          フルネーム
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          LINE表示名
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          招待元
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          最終ログイン
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          登録日
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          権限
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {staffUsers.map(user => {
                        const owner = user.ownerUserId
                          ? ownerById.get(user.ownerUserId)
                          : undefined;
                        const ownerLabel =
                          owner?.fullName || owner?.lineDisplayName || user.ownerUserId || '不明';

                        return (
                          <tr key={user.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {user.fullName || '未入力'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {user.lineDisplayName}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {ownerLabel}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDateTimeWithSeconds(user.lastLoginAt, '未ログイン')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDateTimeWithSeconds(user.createdAt, '登録日不明')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span
                                className={`px-2 py-1 text-xs rounded-full ${getRoleColor(
                                  user.role
                                )}`}
                              >
                                {getRoleDisplayName(user.role)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
