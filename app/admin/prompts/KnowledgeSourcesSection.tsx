'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { KnowledgeSourceListItem } from '@/types/knowledgeSource';
import { KNOWLEDGE_DOC_WARN_CHARS_TOTAL } from '@/lib/knowledgeBudget';
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  fetchKnowledgeSources,
  refreshKnowledgeSource,
  updateKnowledgeSource,
} from '@/server/actions/adminKnowledgeSources.actions';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import KnowledgeSourcesAddForm from './knowledge-sources/KnowledgeSourcesAddForm';
import KnowledgeSourceTableRow from './knowledge-sources/KnowledgeSourceTableRow';
import KnowledgeSourcesConfirmDialog from './knowledge-sources/KnowledgeSourcesConfirmDialog';
import {
  formatKnowledgeSourceDateTime,
  type KnowledgeSourcesConfirmAction,
} from './knowledge-sources/knowledgeSourcesUiUtils';

type KnowledgeSourcesSectionProps = {
  initialSources: KnowledgeSourceListItem[];
  initialError?: string | null;
};

export default function KnowledgeSourcesSection({
  initialSources,
  initialError,
}: KnowledgeSourcesSectionProps) {
  const [sources, setSources] = useState(initialSources);
  const [sectionExpanded, setSectionExpanded] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<KnowledgeSourcesConfirmAction | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftActive, setDraftActive] = useState(true);
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { name: string; sourceUrl: string }>
  >({});

  const activeSources = useMemo(
    () => sources.filter(source => source.is_active),
    [sources]
  );
  const totalActiveChars = useMemo(
    () => activeSources.reduce((sum, source) => sum + source.content.length, 0),
    [activeSources]
  );
  const errorCount = useMemo(
    () => sources.filter(source => source.last_fetch_error).length,
    [sources]
  );
  const latestUpdatedAt = useMemo(() => {
    const timestamps = sources
      .map(source => source.last_fetched_at ?? source.updated_at)
      .filter(Boolean)
      .sort()
      .reverse();
    return timestamps[0] ?? null;
  }, [sources]);

  const reloadSources = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchKnowledgeSources();
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (result.success && result.data) {
        setSources(result.data);
      } else {
        toast.error(result.error ?? '一覧の再取得に失敗しました');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleConfirm = async () => {
    if (!confirmAction) return;

    if (confirmAction.type === 'create') {
      const result = await createKnowledgeSource({
        name: confirmAction.name,
        sourceUrl: confirmAction.sourceUrl,
        isActive: confirmAction.isActive,
      });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSources(prev => [...prev, result.data].sort((a, b) => a.sort_order - b.sort_order));
      setDraftName('');
      setDraftUrl('');
      setDraftActive(true);
      toast.success('Google ドキュメントを追加しました');
    }

    if (confirmAction.type === 'delete') {
      const result = await deleteKnowledgeSource({ id: confirmAction.source.id });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSources(prev => prev.filter(source => source.id !== confirmAction.source.id));
      toast.success('Google ドキュメントを削除しました');
    }

    if (confirmAction.type === 'toggle') {
      const result = await updateKnowledgeSource({
        id: confirmAction.source.id,
        isActive: confirmAction.nextActive,
      });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSources(prev =>
        prev.map(source => (source.id === result.data.id ? result.data : source))
      );
      toast.success(confirmAction.nextActive ? '有効化しました' : '無効化しました');
    }

    setConfirmAction(null);
  };

  const handleRefresh = async (source: KnowledgeSourceListItem) => {
    setRefreshingId(source.id);
    try {
      const result = await refreshKnowledgeSource({ id: source.id });
      if (isEmailLinkConflictResult(result)) {
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSources(prev => prev.map(item => (item.id === result.data.id ? result.data : item)));
      if (result.data.last_fetch_error) {
        toast.warning('取得に失敗しました', { description: result.data.last_fetch_error });
      } else {
        toast.success('Google ドキュメントを更新しました');
      }
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSaveRow = async (source: KnowledgeSourceListItem) => {
    const draft = editDrafts[source.id];
    if (!draft) return;

    const result = await updateKnowledgeSource({
      id: source.id,
      name: draft.name,
      sourceUrl: draft.sourceUrl,
    });
    if (isEmailLinkConflictResult(result)) {
      replaceToEmailLinkConflictLogin();
      return;
    }
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setSources(prev => prev.map(item => (item.id === result.data.id ? result.data : item)));
    toast.success('保存しました');
  };

  const toggleRow = (source: KnowledgeSourceListItem) => {
    setExpandedRowId(prev => {
      const next = prev === source.id ? null : source.id;
      if (next) {
        setEditDrafts(current => ({
          ...current,
          [source.id]: {
            name: current[source.id]?.name ?? source.name,
            sourceUrl: current[source.id]?.sourceUrl ?? source.source_url,
          },
        }));
      }
      return next;
    });
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
              <CardTitle className="text-lg">カオルさん共通 Google ドキュメント</CardTitle>
              <p className="text-sm text-muted-foreground">
                有効 Doc {activeSources.length} 件
                {latestUpdatedAt ? ` · 最終更新 ${formatKnowledgeSourceDateTime(latestUpdatedAt)}` : ''}
                {errorCount > 0 ? ` · エラー ${errorCount} 件` : ''}
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
            {initialError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {initialError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setConfirmAction({
                    type: 'create',
                    name: draftName.trim(),
                    sourceUrl: draftUrl.trim(),
                    isActive: draftActive,
                  })
                }
                disabled={!draftName.trim() || !draftUrl.trim()}
              >
                <Plus className="mr-1 h-4 w-4" />
                Doc を追加
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void reloadSources()}
                disabled={isLoading}
              >
                <RefreshCw className={`mr-1 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                一覧更新
              </Button>
            </div>

            <KnowledgeSourcesAddForm
              draftName={draftName}
              draftUrl={draftUrl}
              draftActive={draftActive}
              onDraftNameChange={setDraftName}
              onDraftUrlChange={setDraftUrl}
              onDraftActiveChange={setDraftActive}
            />

            {totalActiveChars > KNOWLEDGE_DOC_WARN_CHARS_TOTAL && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                有効 Doc 合計 {totalActiveChars.toLocaleString()} 字（目安{' '}
                {KNOWLEDGE_DOC_WARN_CHARS_TOTAL.toLocaleString()} 字超）
              </div>
            )}

            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">表示名</th>
                    <th className="px-3 py-2 font-medium">有効</th>
                    <th className="px-3 py-2 font-medium">最終取得</th>
                    <th className="px-3 py-2 font-medium">状態</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        登録済み Doc はありません
                      </td>
                    </tr>
                  ) : (
                    sources.map(source => (
                      <KnowledgeSourceTableRow
                        key={source.id}
                        source={source}
                        isExpanded={expandedRowId === source.id}
                        draft={editDrafts[source.id]}
                        isRefreshing={refreshingId === source.id}
                        onToggleExpand={() => toggleRow(source)}
                        onToggleActive={nextActive =>
                          setConfirmAction({ type: 'toggle', source, nextActive })
                        }
                        onRefresh={() => void handleRefresh(source)}
                        onDelete={() => setConfirmAction({ type: 'delete', source })}
                        onDraftChange={draft =>
                          setEditDrafts(prev => ({ ...prev, [source.id]: draft }))
                        }
                        onSave={() => void handleSaveRow(source)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      <KnowledgeSourcesConfirmDialog
        confirmAction={confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}
