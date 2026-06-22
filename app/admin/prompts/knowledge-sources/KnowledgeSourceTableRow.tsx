'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Trash2 } from 'lucide-react';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';
import {
  DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS,
  KNOWLEDGE_DOC_WARN_CHARS_PER_DOC,
  estimateTextTokens,
} from '@/lib/knowledgeBudget';
import {
  formatKnowledgeSourceDateTime,
  getKnowledgeSourceStatus,
} from './knowledgeSourcesUiUtils';

type RowDraft = { name: string; sourceUrl: string };

type KnowledgeSourceTableRowProps = {
  source: KnowledgeSourceListItem;
  isExpanded: boolean;
  draft: RowDraft | undefined;
  isRefreshing: boolean;
  onToggleExpand: () => void;
  onToggleActive: (nextActive: boolean) => void;
  onRefresh: () => void;
  onDelete: () => void;
  onDraftChange: (draft: RowDraft) => void;
  onSave: () => void;
};

export default function KnowledgeSourceTableRow({
  source,
  isExpanded,
  draft,
  isRefreshing,
  onToggleExpand,
  onToggleActive,
  onRefresh,
  onDelete,
  onDraftChange,
  onSave,
}: KnowledgeSourceTableRowProps) {
  const status = getKnowledgeSourceStatus(source);
  const charCount = source.content.length;
  const tokenEstimate = estimateTextTokens(source.content);

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-3">
        <div className="font-medium">{source.name}</div>
        {source.last_fetch_error && (
          <p className="mt-1 text-xs text-destructive">{source.last_fetch_error}</p>
        )}
      </td>
      <td className="px-3 py-3">
        <Checkbox
          checked={source.is_active}
          onCheckedChange={checked => onToggleActive(checked === true)}
          aria-label={`${source.name} の有効状態`}
        />
      </td>
      <td className="px-3 py-3 whitespace-nowrap">{formatKnowledgeSourceDateTime(source.last_fetched_at)}</td>
      <td className="px-3 py-3">
        <Badge variant={status.variant}>{status.label}</Badge>
        {source.last_fetch_error && source.content.trim() && (
          <p className="mt-1 text-xs text-muted-foreground">最終成功版を使用中</p>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onToggleExpand}>
            {isExpanded ? '閉じる' : '詳細'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw className={`mr-1 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            更新
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {isExpanded && draft && (
          <div className="mt-3 space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="space-y-1">
              <Label htmlFor={`name-${source.id}`}>表示名</Label>
              <Input
                id={`name-${source.id}`}
                value={draft.name}
                onChange={event => onDraftChange({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`url-${source.id}`}>URL</Label>
              <Input
                id={`url-${source.id}`}
                value={draft.sourceUrl}
                onChange={event => onDraftChange({ ...draft, sourceUrl: event.target.value })}
              />
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                文字数 {charCount.toLocaleString()} / 推定 token {tokenEstimate.toLocaleString()}
              </p>
              {charCount > KNOWLEDGE_DOC_WARN_CHARS_PER_DOC && (
                <p className="text-amber-700">
                  1 Doc {KNOWLEDGE_DOC_WARN_CHARS_PER_DOC.toLocaleString()} 字警告を超過
                </p>
              )}
              <p>
                注入 budget {DEFAULT_KNOWLEDGE_INJECTION_BUDGET_TOKENS.toLocaleString()} token（超過時は先頭優先で
                trim）
              </p>
            </div>
            <Button type="button" size="sm" onClick={onSave}>
              保存
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
