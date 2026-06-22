import { redirect } from 'next/navigation';
import PromptsClient from './PromptsClient';
import { fetchPrompts } from '@/server/actions/adminPrompts.actions';
import { fetchKnowledgeSources } from '@/server/actions/adminKnowledgeSources.actions';
import { PromptTemplate } from '@/types/prompt';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  const [promptsRes, knowledgeRes] = await Promise.all([fetchPrompts(), fetchKnowledgeSources()]);

  if (promptsRes && !promptsRes.success && 'emailLinkConflict' in promptsRes && promptsRes.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }

  const knowledgeSources = knowledgeRes.success ? (knowledgeRes.data as KnowledgeSourceListItem[]) : [];
  const knowledgeError =
    knowledgeRes.success || !('error' in knowledgeRes)
      ? null
      : typeof knowledgeRes.error === 'string'
        ? knowledgeRes.error
        : 'Google ドキュメント一覧の取得に失敗しました';

  if (!promptsRes?.success || !promptsRes.data) {
    const error =
      promptsRes && !promptsRes.success && 'error' in promptsRes && typeof promptsRes.error === 'string'
        ? promptsRes.error
        : 'プロンプトの取得に失敗しました';
    return (
      <PromptsClient
        initialTemplates={[]}
        initialKnowledgeSources={knowledgeSources}
        initialKnowledgeError={knowledgeError}
        initialError={error}
      />
    );
  }

  const templates = promptsRes.data as PromptTemplate[];

  return (
    <PromptsClient
      initialTemplates={templates}
      initialKnowledgeSources={knowledgeSources}
      initialKnowledgeError={knowledgeError}
    />
  );
}
