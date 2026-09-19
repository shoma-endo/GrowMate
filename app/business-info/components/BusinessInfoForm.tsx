// Server Component（AGENTS.md準拠：認証状態チェックのみ）
import { getBriefServer } from '@/server/actions/brief.actions';
import BusinessInfoFormClient from './BusinessInfoFormClient';

export default async function BusinessInfoForm() {
  const { data: businessInfo, error } = await getBriefServer();

  if (error) {
    return (
      <div className="text-center text-red-600 p-4">
        <p>事業者情報の読み込みに失敗しました</p>
        <p className="text-sm mt-2">{error}</p>
      </div>
    );
  }

  return <BusinessInfoFormClient initialData={businessInfo ?? null} />;
}
