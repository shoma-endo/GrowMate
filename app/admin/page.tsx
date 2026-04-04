import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">管理者ダッシュボード</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span className="text-blue-600">🎯</span>
              <span>プロンプト管理</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <p className="text-gray-600 mb-4 flex-1">
              AIチャット時のシステムプロンプトテンプレートを編集・管理します
            </p>
            <Button asChild className="w-full">
              <Link href="/admin/prompts">プロンプト管理画面へ</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span className="text-green-600">👥</span>
              <span>ユーザー管理</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <p className="text-gray-600 mb-4 flex-1">
              登録ユーザーの管理と権限状況を確認します
            </p>
            <Button asChild className="w-full">
              <Link href="/admin/users">ユーザー管理画面へ</Link>
            </Button>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
