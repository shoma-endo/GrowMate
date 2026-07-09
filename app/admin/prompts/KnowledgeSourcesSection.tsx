'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getGlobalKnowledgeContentStats, validateGlobalKnowledgeContent } from '@/lib/globalKnowledgeContentValidation';
import {
  saveGlobalKnowledgeContent,
  type GlobalKnowledgeSourceSummary,
} from '@/server/actions/adminKnowledgeSources.actions';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';

type KnowledgeSourcesSectionProps = {
  initialSource: GlobalKnowledgeSourceSummary | null;
  initialError?: string | null | undefined;
};

function formatSavedAt(value: string | null): string {
  if (!value) return '未保存';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未保存';
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function KnowledgeSourcesSection({
  initialSource,
  initialError,
}: KnowledgeSourcesSectionProps) {
  const [sectionExpanded, setSectionExpanded] = useState(false);
  const [source, setSource] = useState<GlobalKnowledgeSourceSummary | null>(initialSource);
  const [draftText, setDraftText] = useState(initialSource?.content ?? '');
  const [savedText, setSavedText] = useState(initialSource?.content ?? '');
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSource(initialSource);
    setDraftText(initialSource?.content ?? '');
    setSavedText(initialSource?.content ?? '');
    setLoadError(initialError ?? null);
  }, [initialSource, initialError]);

  const stats = useMemo(() => getGlobalKnowledgeContentStats(draftText), [draftText]);
  const validationError = useMemo(() => validateGlobalKnowledgeContent(draftText), [draftText]);
  const hasSavedText = savedText.trim().length > 0;
  const hasChanges = draftText !== savedText;
  const statusLabel = hasSavedText ? '保存済み' : '未設定';

  const handleSave = async () => {
    if (validationError) {
      setSaveError(validationError);
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await saveGlobalKnowledgeContent({ content: draftText });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        setSaveError(result.error);
        toast.error(result.error);
        return;
      }

      setSource(result.data);
      setSavedText(result.data.content);
      setDraftText(result.data.content);
      setSaveError(null);
      toast.success('共通プロンプトを保存しました');
    } catch (error) {
      console.error('[KnowledgeSourcesSection] save failed', error);
      const message = '共通プロンプトの保存に失敗しました';
      setSaveError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setDraftText(savedText);
    setSaveError(null);
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
            <CardTitle className="text-lg">共通プロンプト</CardTitle>
            <p className="text-sm text-muted-foreground">
              {statusLabel} · 最終保存 {formatSavedAt(source?.updatedAt ?? null)}
              {saveError ? ' · エラーあり' : ''}
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
          {loadError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError}
            </div>
          )}

          <div>
            <label htmlFor="global-knowledge-content" className="mb-2 block text-sm font-medium text-gray-700">
              プロンプト内容
            </label>
            <Textarea
              id="global-knowledge-content"
              value={draftText}
              onChange={event => setDraftText(event.target.value)}
              rows={12}
              className="w-full"
              placeholder="プロンプト内容を入力してください"
              aria-label="共通プロンプト内容編集"
              tabIndex={0}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {stats.charCount.toLocaleString()} 字 · 約 {stats.estimatedTokens.toLocaleString()}{' '}
                token
              </span>
              {hasChanges && <span>未保存の変更があります</span>}
            </div>
          </div>

          {stats.isWarnChars && !validationError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              20,000 字を超えています。長尺生成で overflow リスクが高まります。
            </div>
          )}

          {(validationError || saveError) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {validationError ?? saveError}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasChanges || !!validationError || isSaving || !source}
              aria-label="保存"
              tabIndex={0}
            >
              {isSaving ? (
                '保存中...'
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  保存
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={!hasChanges || isSaving}
              aria-label="リセット"
              tabIndex={0}
            >
              リセット
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
