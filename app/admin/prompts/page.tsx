import { redirect } from 'next/navigation';
import PromptsClient from './PromptsClient';
import { fetchPrompts } from '@/server/actions/adminPrompts.actions';
import { fetchGlobalKnowledgeSource } from '@/server/actions/adminKnowledgeSources.actions';
import { PromptTemplate } from '@/types/prompt';

export const dynamic = 'force-dynamic';

export default async function PromptsPage() {
  const [promptsRes, globalKnowledgeRes] = await Promise.all([
    fetchPrompts(),
    fetchGlobalKnowledgeSource(),
  ]);

  if (promptsRes && !promptsRes.success && 'emailLinkConflict' in promptsRes && promptsRes.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }

  if (globalKnowledgeRes && !globalKnowledgeRes.success && 'emailLinkConflict' in globalKnowledgeRes && globalKnowledgeRes.emailLinkConflict) {
    redirect('/login?reason=email_link_conflict');
  }

  if (!promptsRes?.success || !promptsRes.data) {
    const error =
      promptsRes && !promptsRes.success && 'error' in promptsRes && typeof promptsRes.error === 'string'
        ? promptsRes.error
        : 'プロンプトの取得に失敗しました';
    return (
      <PromptsClient
        initialTemplates={[]}
        initialError={error}
        initialGlobalKnowledgeSource={null}
        initialGlobalKnowledgeError={
          globalKnowledgeRes && !globalKnowledgeRes.success ? globalKnowledgeRes.error : null
        }
      />
    );
  }

  const templates = promptsRes.data as PromptTemplate[];

  return (
    <PromptsClient
      initialTemplates={templates}
      initialGlobalKnowledgeSource={
        globalKnowledgeRes.success ? globalKnowledgeRes.data : null
      }
      initialGlobalKnowledgeError={
        globalKnowledgeRes && !globalKnowledgeRes.success ? globalKnowledgeRes.error : null
      }
    />
  );
}
