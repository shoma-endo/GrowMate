import { redirect } from 'next/navigation';
import PromptsClient from './PromptsClient';
import { fetchPrompts } from '@/server/actions/adminPrompts.actions';
import { PromptTemplate } from '@/types/prompt';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  const res = await fetchPrompts();

  if (!res?.success || !res.data) {
    if (res && !res.success && 'emailLinkConflict' in res && res.emailLinkConflict) {
      redirect('/login?reason=email_link_conflict');
    }
    const error =
      res && !res.success && 'error' in res && typeof res.error === 'string'
        ? res.error
        : 'プロンプトの取得に失敗しました';
    return <PromptsClient initialTemplates={[]} initialError={error} />;
  }

  const templates = res.data as PromptTemplate[];

  return <PromptsClient initialTemplates={templates} />;
}
