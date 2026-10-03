import { z } from 'zod';
import { extractJsonObjectText } from '@/server/lib/llm-json';

const keywordProposalSchema = z.object({
  main_kw: z.string().trim().min(1),
  kw: z.array(z.string().trim().min(1)).min(1),
});

export type InstagramKeywordProposal = z.infer<typeof keywordProposalSchema>;

export function parseInstagramKeywordProposal(content: string): InstagramKeywordProposal {
  const json = extractJsonObjectText(content);
  if (json === null) throw new Error('Keyword proposal JSON not found');
  return keywordProposalSchema.parse(JSON.parse(json) as unknown);
}

export function buildInstagramStep1Input(mainKw: string, keywords: string[], caption: string): string {
  return `${[mainKw, ...keywords].join('\n')}\n\n【元になった Instagram 投稿】\n${caption}`;
}

export function buildInstagramStep6Input(previousOutput: string, caption: string): string {
  return `${previousOutput}\n\n【一次情報（元の Instagram 投稿）】\n${caption}`;
}

export function buildInstagramHeadingInput(heading: string): string {
  return `「${heading}」の本文を書いてください`;
}

export function extractStep6LeadPatternA(content: string): string | null {
  const sectionStart = content.indexOf('【書き出し案：パターンA');
  if (sectionStart < 0) return null;
  const normalStart = content.indexOf('▼本文（通常版）', sectionStart);
  if (normalStart < 0) return null;
  const bodyStart = normalStart + '▼本文（通常版）'.length;
  const shortStart = content.indexOf('▼本文（短縮版）', bodyStart);
  if (shortStart < 0) return null;
  const body = content.slice(bodyStart, shortStart).trim();
  return body || null;
}

export type InstagramResumeAction = 'generate' | 'continue' | 'advance';

export function getInstagramResumeAction(
  continuationCount: number | null,
  lastAssistantModelMatchesStage: boolean
): InstagramResumeAction {
  if (continuationCount === null) {
    return lastAssistantModelMatchesStage ? 'advance' : 'generate';
  }
  return lastAssistantModelMatchesStage ? 'continue' : 'generate';
}
