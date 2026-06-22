'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type KnowledgeSourcesAddFormProps = {
  draftName: string;
  draftUrl: string;
  draftActive: boolean;
  onDraftNameChange: (value: string) => void;
  onDraftUrlChange: (value: string) => void;
  onDraftActiveChange: (value: boolean) => void;
};

export default function KnowledgeSourcesAddForm({
  draftName,
  draftUrl,
  draftActive,
  onDraftNameChange,
  onDraftUrlChange,
  onDraftActiveChange,
}: KnowledgeSourcesAddFormProps) {
  return (
    <div className="grid gap-3 rounded-md border p-3 md:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="new-doc-name">表示名</Label>
        <Input
          id="new-doc-name"
          value={draftName}
          onChange={event => onDraftNameChange(event.target.value)}
          placeholder="ノウハウ 2026"
        />
      </div>
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="new-doc-url">Google ドキュメント URL</Label>
        <Input
          id="new-doc-url"
          value={draftUrl}
          onChange={event => onDraftUrlChange(event.target.value)}
          placeholder="https://docs.google.com/document/d/..."
        />
      </div>
      <div className="flex items-center gap-2 md:col-span-3">
        <Checkbox
          id="new-doc-active"
          checked={draftActive}
          onCheckedChange={checked => onDraftActiveChange(checked === true)}
        />
        <Label htmlFor="new-doc-active">追加後すぐ有効化</Label>
      </div>
    </div>
  );
}
