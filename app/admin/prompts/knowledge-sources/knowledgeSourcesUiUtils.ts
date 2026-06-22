import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';

export type KnowledgeSourcesConfirmAction =
  | { type: 'create'; name: string; sourceUrl: string; isActive: boolean }
  | { type: 'delete'; source: KnowledgeSourceListItem }
  | { type: 'toggle'; source: KnowledgeSourceListItem; nextActive: boolean };

export function formatKnowledgeSourceDateTime(value: string | null): string {
  if (!value) return '未取得';
  return new Date(value).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getKnowledgeSourceStatus(source: KnowledgeSourceListItem): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (source.last_fetch_error) {
    return source.content.trim()
      ? { label: 'stale使用中', variant: 'destructive' }
      : { label: '取得失敗', variant: 'destructive' };
  }
  if (source.content.trim()) {
    return { label: '取得済み', variant: 'default' };
  }
  return { label: '未取得', variant: 'secondary' };
}
