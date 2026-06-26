import { estimateTextTokens } from '@/lib/knowledgeBudget';

const KNOWLEDGE_SOURCE_OVERRIDE_STORAGE_KEY = 'growmate:knowledge-source-preview:v1';
export const KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS = 50_000;
export const KNOWLEDGE_SOURCE_OVERRIDE_BUDGET_TOKENS = 40_000;

interface KnowledgeSourceOverrideStats {
  charCount: number;
  estimatedTokens: number;
}

export function normalizeKnowledgeSourceOverrideText(text: string | undefined): string {
  if (!text) return '';
  return text.trim();
}

export function getKnowledgeSourceOverrideStats(text: string): KnowledgeSourceOverrideStats {
  return {
    charCount: text.length,
    estimatedTokens: estimateTextTokens(text),
  };
}

export function validateKnowledgeSourceOverrideText(text: string): string | null {
  if (text.length > KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS) {
    return `検証テキストは ${KNOWLEDGE_SOURCE_OVERRIDE_MAX_CHARS.toLocaleString()} 字以内にしてください（現在 ${text.length.toLocaleString()} 字）`;
  }
  return null;
}

export function readKnowledgeSourceOverrideText(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(KNOWLEDGE_SOURCE_OVERRIDE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveKnowledgeSourceOverrideText(text: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KNOWLEDGE_SOURCE_OVERRIDE_STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function removeKnowledgeSourceOverrideText(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.removeItem(KNOWLEDGE_SOURCE_OVERRIDE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
