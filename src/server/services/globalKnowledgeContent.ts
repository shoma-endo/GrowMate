import 'server-only';

import { cache } from 'react';
import { GLOBAL_KNOWLEDGE_SOURCE_NAME } from '@/lib/globalKnowledgeContentValidation';
import { PromptService } from '@/server/services/promptService';
import type { PromptTemplate } from '@/types/prompt';

export const getGlobalKnowledgeContent = cache(async (): Promise<string> => {
  const template = await PromptService.getTemplateByName(GLOBAL_KNOWLEDGE_SOURCE_NAME);
  if (!template?.content.trim()) {
    return '';
  }
  return template.content;
});

export async function getGlobalKnowledgeSourceTemplate(): Promise<PromptTemplate | null> {
  return PromptService.getTemplateByName(GLOBAL_KNOWLEDGE_SOURCE_NAME);
}
