'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getGlobalKnowledgeContentStats, validateGlobalKnowledgeContent } from '@/lib/globalKnowledgeContentValidation';
import {
  fetchGlobalKnowledgeSource,
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
  const [rowExpanded, setRowExpanded] = useState(false);
  const [source, setSource] = useState<GlobalKnowledgeSourceSummary | null>(initialSource);
  const [draftText, setDraftText] = useState(initialSource?.content ?? '');
  const [savedText, setSavedText] = useState(initialSource?.content ?? '');
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const reloadSource = useCallback(async () => {
    const result = await fetchGlobalKnowledgeSource();
    if (isEmailLinkConflictResult(result)) {
      replaceToEmailLinkConflictLogin();
      return;
    }
    if (!result.success) {
      setLoadError(result.error);
      return;
    }
    setSource(result.data);
    setDraftText(result.data.content);
    setSavedText(result.data.content);
    setLoadError(null);
  }, []);

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
      setConfirmOpen(false);
    }
  };

  return (
    <>
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

            <div className="rounded-md border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setRowExpanded(prev => !prev)}
                aria-expanded={rowExpanded}
              >
                <div className="space-y-1">
                  <p className="font-medium">{source?.displayName ?? '共通プロンプト'}</p>
                  <p className="text-sm text-muted-foreground">
                    最終保存 {formatSavedAt(source?.updatedAt ?? null)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {hasSavedText ? (
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                      保存済み
                    </span>
                  ) : (
                    <span>未設定</span>
                  )}
                  {rowExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
              </button>

              {rowExpanded && (
                <div className="space-y-4 border-t px-4 py-4">
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    有料 Pro ユーザー（paid / admin）の対象生成へ、毎回 L1 として注入されます。空のまま保存すると L1 は注入されません。
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="global-knowledge-content" className="text-sm font-medium">
                      共通プロンプト本文
                    </label>
                    <Textarea
                      id="global-knowledge-content"
                      value={draftText}
                      onChange={event => setDraftText(event.target.value)}
                      rows={12}
                      placeholder="共通プロンプト本文を入力してください"
                      aria-label="共通プロンプト本文"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {stats.charCount.toLocaleString()} 字 · 約{' '}
                        {stats.estimatedTokens.toLocaleString()} token · 注入 budget{' '}
                        {stats.budgetTokens.toLocaleString()} token
                      </span>
                      {hasChanges && <span>未保存の変更があります</span>}
                    </div>
                  </div>

                  {stats.isWarnChars && !validationError && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      20,000 字を超えています。step7 など長尺生成で overflow リスクが高まります。
                    </div>
                  )}

                  {(validationError || saveError) && (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {validationError ?? saveError}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => setConfirmOpen(true)}
                      disabled={!hasChanges || !!validationError || isSaving || !source}
                    >
                      <Save className="h-4 w-4" />
                      保存
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void reloadSource()}
                      disabled={isSaving}
                    >
                      再読み込み
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>共通プロンプトを保存しますか？</DialogTitle>
            <DialogDescription>
              保存後の次回生成から反映されます。未保存の変更は {stats.charCount.toLocaleString()}{' '}
              字（約 {stats.estimatedTokens.toLocaleString()} token）です。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
              保存する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
