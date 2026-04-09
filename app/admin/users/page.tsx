import UsersClient from './UsersClient';
import { getAllUsers } from '@/server/actions/admin.actions';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const result = await getAllUsers();

  if (!result.success || !result.users) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">ユーザー管理</h1>
        </div>
        <div className="text-center py-8 text-red-600">
          <p>{result.error || 'ユーザー一覧の取得に失敗しました'}</p>
        </div>
      </div>
    );
  }

  return <UsersClient initialUsers={result.users} />;
}
