import PromptsClient from './PromptsClient';
import { fetchPrompts } from '@/server/actions/adminPrompts.actions';
import { PromptTemplate } from '@/types/prompt';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  const res = await fetchPrompts();

  if (!res?.success || !res.data) {
    const error = res?.error || 'プロンプトの取得に失敗しました';
    return <PromptsClient initialTemplates={[]} initialError={error} />;
  }

  const templates = res.data as PromptTemplate[];

  return <PromptsClient initialTemplates={templates} />;
}
