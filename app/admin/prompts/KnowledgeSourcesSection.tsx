'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ChevronDown, ChevronRight, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  getKnowledgeSourceOverrideStats,
  readKnowledgeSourceOverrideText,
  removeKnowledgeSourceOverrideText,
  saveKnowledgeSourceOverrideText,
  validateKnowledgeSourceOverrideText,
} from '@/lib/knowledgeSourceOverride';

export default function KnowledgeSourcesSection() {
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [draftText, setDraftText] = useState('');
  const [savedText, setSavedText] = useState('');

  useEffect(() => {
    const storedText = readKnowledgeSourceOverrideText();
    setDraftText(storedText);
    setSavedText(storedText);
  }, []);

  const stats = useMemo(() => getKnowledgeSourceOverrideStats(draftText), [draftText]);
  const validationError = useMemo(
    () => validateKnowledgeSourceOverrideText(draftText),
    [draftText]
  );
  const hasSavedText = savedText.trim().length > 0;
  const hasChanges = draftText !== savedText;

  const handleSave = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const saved = saveKnowledgeSourceOverrideText(draftText);
    if (!saved) {
      toast.error('ブラウザ保存に失敗しました');
      return;
    }

    setSavedText(draftText);
    toast.success('検証用テキストをブラウザに保存しました');
  };

  const handleDelete = () => {
    const removed = removeKnowledgeSourceOverrideText();
    if (!removed) {
      toast.error('検証用テキストの削除に失敗しました');
      return;
    }

    setDraftText('');
    setSavedText('');
    toast.success('検証用テキストを削除しました');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setSectionExpanded(prev => !prev)}
          aria-expanded={sectionExpanded}
        >
          <div className="space-y-1">
            <CardTitle className="text-lg">検証用テキスト入力</CardTitle>
            <p className="text-sm text-muted-foreground">
              {hasSavedText ? 'ブラウザ保存済み' : '未保存'} · {stats.charCount.toLocaleString()}{' '}
              字 · 約 {stats.estimatedTokens.toLocaleString()} token
            </p>
          </div>
          {sectionExpanded ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </CardHeader>

      {sectionExpanded && (
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Google ドキュメント取得前の検証用です。ここで保存したテキストはこのブラウザの
            localStorage にのみ保存され、データベースには保存されません。
          </div>

          <div className="space-y-2">
            <label htmlFor="knowledge-source-preview" className="text-sm font-medium">
              検証用テキスト
            </label>
            <Textarea
              id="knowledge-source-preview"
              value={draftText}
              onChange={event => setDraftText(event.target.value)}
              rows={12}
              placeholder="チャット生成で検証したい考え方・ノウハウを入力してください"
              aria-label="検証用ナレッジ本文"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {stats.charCount.toLocaleString()} 字 · 約{' '}
                {stats.estimatedTokens.toLocaleString()} token
              </span>
              {hasChanges && <span>未保存の変更があります</span>}
            </div>
          </div>

          {validationError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {validationError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={!hasChanges || !!validationError}
            >
              <Save className="h-4 w-4" />
              ブラウザに保存
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDelete}
              disabled={!hasSavedText && !draftText}
            >
              <Trash2 className="h-4 w-4" />
              削除
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
