import {
  KNOWLEDGE_DOC_HARD_REJECT_CHARS_PER_DOC,
  KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL,
} from '@/lib/knowledgeBudget';

export function validateFetchedKnowledgeContent(
  fetchedText: string,
  otherActiveContents: string[]
): string | null {
  if (fetchedText.length > KNOWLEDGE_DOC_HARD_REJECT_CHARS_PER_DOC) {
    return `1 Doc あたり ${KNOWLEDGE_DOC_HARD_REJECT_CHARS_PER_DOC.toLocaleString()} 字を超えているため保存できません（${fetchedText.length.toLocaleString()} 字）`;
  }

  const totalChars =
    fetchedText.length + otherActiveContents.reduce((sum, content) => sum + content.length, 0);
  if (totalChars > KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL) {
    return `有効 Doc 合計 ${KNOWLEDGE_DOC_HARD_REJECT_CHARS_TOTAL.toLocaleString()} 字を超えているため保存できません（${totalChars.toLocaleString()} 字）`;
  }

  return null;
}
