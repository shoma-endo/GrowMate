'use client';

import * as React from 'react';
import FieldConfigurator from '@/components/FieldConfigurator';
import TruncatedText from '@/components/TruncatedText';
import AnnotationFormFields from '@/components/AnnotationFormFields';
import CategoryFilter from '@/components/CategoryFilter';
import {
  ANALYTICS_COLUMNS,
  BLOG_STEP_IDS,
  ANALYTICS_STORAGE_KEYS,
  loadCategoryFilterFromStorage,
  type BlogStepId,
} from '@/lib/constants';
import type { AnalyticsContentItem } from '@/types/analytics';
import {
  ensureAnnotationChatSession,
  updateContentAnnotationFields,
  deleteContentAnnotation,
} from '@/server/actions/wordpress.actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Loader2,
  Bell,
  FileText,
  Edit,
  Trash2,
  ChevronsLeft,
  ChevronsRight,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ANNOTATION_FIELD_KEYS, type AnnotationFieldKey } from '@/types/annotation';
import { DeleteChatDialog } from '@/components/DeleteChatDialog';
import { ChatService } from '@/domain/services/chatService';
import { useLiffContext } from '@/components/LiffProvider';

interface Props {
  items: AnalyticsContentItem[];
  unreadAnnotationIds?: Set<string>;
}

interface LaunchPayload {
  rowKey: string;
  sessionId?: string | null;
  annotationId?: string | null;
  wpPostId?: number | null;
  wpPostTitle?: string | null;
  canonicalUrl?: string | null;
  fallbackTitle?: string | null;
  initialStep?: BlogStepId | null;
}

interface LaunchChatButtonProps {
  label: string;
  isPending: boolean;
  onClick: () => void;
}

function LaunchChatButton({ label, isPending, onClick }: LaunchChatButtonProps) {
  return (
    <Button
      variant="default"
      size="sm"
      className="bg-green-600 hover:bg-green-700 text-white focus-visible:ring-green-400"
      onClick={onClick}
      disabled={isPending}
    >
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          移動中...
        </>
      ) : (
        label
      )}
    </Button>
  );
}

const formatPercent = (value: number, fractionDigits: number = 1): string =>
  `${(value * 100).toFixed(fractionDigits)}%`;

const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0秒';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins <= 0) return `${secs}秒`;
  return `${mins}分${secs}秒`;
};

const createEmptyForm = (): Record<AnnotationFieldKey, string> =>
  Object.fromEntries(ANNOTATION_FIELD_KEYS.map(key => [key, ''])) as Record<
    AnnotationFieldKey,
    string
  >;

export default function AnalyticsTable({ items, unreadAnnotationIds }: Props) {
  const router = useRouter();
  const { getAccessToken, isOwnerViewMode } = useLiffContext();
  const isReadOnly = isOwnerViewMode;
  const [pendingRowKey, setPendingRowKey] = React.useState<string | null>(null);
  const [editingRowKey, setEditingRowKey] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Record<AnnotationFieldKey, string>>(createEmptyForm);
  const [canonicalUrl, setCanonicalUrl] = React.useState('');
  const [canonicalUrlError, setCanonicalUrlError] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [wpPostTitle, setWpPostTitle] = React.useState('');
  const [isPendingEdit, startEditTransition] = React.useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deletingRowKey, setDeletingRowKey] = React.useState<string | null>(null);
  const [deleteTargetTitle, setDeleteTargetTitle] = React.useState('');
  const [deleteTargetSessionId, setDeleteTargetSessionId] = React.useState<string | null>(null);
  const [deleteTargetAnnotationId, setDeleteTargetAnnotationId] = React.useState<string | null>(
    null
  );
  const [hasOrphanContent, setHasOrphanContent] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const chatServiceRef = React.useRef<ChatService | null>(null);

  // フィルター状態をlocalStorageから復元（1回のパースで両方の値を取得）
  const initialFilter = React.useMemo(() => loadCategoryFilterFromStorage(), []);
  const [categoryFilterNames, setCategoryFilterNames] = React.useState<string[]>(
    () => initialFilter.selectedCategoryNames
  );
  const [includeUncategorized, setIncludeUncategorized] = React.useState<boolean>(
    () => initialFilter.includeUncategorized
  );

  // 操作列の展開状態（初期値は true: 展開）
  const [isOpsExpanded, setIsOpsExpanded] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem(ANALYTICS_STORAGE_KEYS.OPS_EXPANDED);
    return saved !== 'false'; // デフォルトは true
  });

  // 操作列の幅（展開/収縮に応じて自動切り替え）
  const opsWidth = React.useMemo(() => {
    return isOpsExpanded ? 380 : 120;
  }, [isOpsExpanded]);

  const columnLabelMap = React.useMemo(
    () =>
      ANALYTICS_COLUMNS.reduce<Record<string, string>>((acc, col) => {
        acc[col.id] = col.label;
        return acc;
      }, {}),
    []
  );

  // ChatService の初期化
  React.useEffect(() => {
    if (!chatServiceRef.current) {
      chatServiceRef.current = new ChatService();
    }
    chatServiceRef.current.setAccessTokenProvider(getAccessToken);
  }, [getAccessToken]);

  const allCategories = React.useMemo(() => {
    const names = new Set<string>();
    for (const item of items) {
      const itemCategories = item.annotation?.wp_category_names ?? [];
      for (const name of itemCategories) {
        if (typeof name === 'string' && name.trim().length > 0) {
          names.add(name);
        }
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [items]);

  // localStorageにフィルター状態を保存するヘルパー
  const saveCategoryFilterToStorage = React.useCallback(
    (selectedNames: string[], includeUncat: boolean) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          ANALYTICS_STORAGE_KEYS.CATEGORY_FILTER,
          JSON.stringify({
            selectedCategoryNames: selectedNames,
            includeUncategorized: includeUncat,
          })
        );
      }
    },
    []
  );

  // カテゴリフィルターの変更ハンドラ
  const handleCategoryFilterChange = React.useCallback(
    (selectedNames: string[], includeUncat: boolean) => {
      setCategoryFilterNames(selectedNames);
      setIncludeUncategorized(includeUncat);
      saveCategoryFilterToStorage(selectedNames, includeUncat);
    },
    [saveCategoryFilterToStorage]
  );

  // フィルタリングされたアイテム
  const filteredItems = React.useMemo(() => {
    // フィルターが何も選択されていない場合は全件表示
    if (categoryFilterNames.length === 0 && !includeUncategorized) {
      return items;
    }

    return items.filter(item => {
      const itemCategories = item.annotation?.wp_category_names ?? [];

      // 未分類の場合
      if (itemCategories.length === 0) {
        return includeUncategorized;
      }

      // いずれかのカテゴリが選択されているか
      return itemCategories.some(cat => categoryFilterNames.includes(cat));
    });
  }, [items, categoryFilterNames, includeUncategorized]);

  // フィルタータグの削除ハンドラ
  const removeCategoryFilter = React.useCallback(
    (categoryName: string) => {
      setCategoryFilterNames(prev => {
        const next = prev.filter(name => name !== categoryName);
        saveCategoryFilterToStorage(next, includeUncategorized);
        return next;
      });
    },
    [includeUncategorized, saveCategoryFilterToStorage]
  );

  // 未分類フィルターの削除ハンドラ
  const removeUncategorizedFilter = React.useCallback(() => {
    setIncludeUncategorized(false);
    saveCategoryFilterToStorage(categoryFilterNames, false);
  }, [categoryFilterNames, saveCategoryFilterToStorage]);

  // 全フィルターをクリア
  const clearAllFilters = React.useCallback(() => {
    setCategoryFilterNames([]);
    setIncludeUncategorized(false);
    saveCategoryFilterToStorage([], false);
  }, [saveCategoryFilterToStorage]);

  // フィルターが適用中かどうか
  const hasActiveFilters = categoryFilterNames.length > 0 || includeUncategorized;

  // 選択中のカテゴリ情報を取得
  const selectedCategoryInfo = React.useMemo(() => {
    return categoryFilterNames;
  }, [categoryFilterNames]);

  const handleLaunch = React.useCallback(
    async (payload: LaunchPayload) => {
      if (pendingRowKey) return;
      const {
        rowKey,
        sessionId,
        annotationId,
        wpPostId,
        wpPostTitle,
        canonicalUrl,
        fallbackTitle,
        initialStep,
      } = payload;
      setPendingRowKey(rowKey);
      try {
        const result = await ensureAnnotationChatSession({
          sessionId: sessionId ?? null,
          annotationId: annotationId ?? null,
          wpPostId: typeof wpPostId === 'number' ? wpPostId : null,
          wpPostTitle: wpPostTitle ?? null,
          canonicalUrl: canonicalUrl ?? null,
          fallbackTitle: fallbackTitle ?? null,
        });
        if (result.success) {
          const searchParams = new URLSearchParams({ session: result.sessionId });
          if (initialStep && BLOG_STEP_IDS.includes(initialStep)) {
            searchParams.set('initialStep', initialStep);
          }
          router.push(`/chat?${searchParams.toString()}`);
        } else {
          console.error(result.error);
          alert(result.error);
        }
      } catch (error) {
        console.error('Failed to launch chat session:', error);
        alert('チャット画面への遷移に失敗しました。再度お試しください。');
      } finally {
        setPendingRowKey(null);
      }
    },
    [pendingRowKey, router]
  );

  // 展開状態の永続化
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ANALYTICS_STORAGE_KEYS.OPS_EXPANDED, String(isOpsExpanded));
  }, [isOpsExpanded]);

  const toggleOpsExpanded = React.useCallback(() => {
    setIsOpsExpanded(prev => !prev);
  }, []);

  const openEdit = React.useCallback(async (item: AnalyticsContentItem) => {
    const annotation = item.annotation;
    const nextForm = Object.fromEntries(
      ANNOTATION_FIELD_KEYS.map(key => [
        key,
        annotation?.[key] ? String(annotation[key] ?? '') : '',
      ])
    ) as Record<AnnotationFieldKey, string>;
    setForm(nextForm);
    setCanonicalUrl(annotation?.canonical_url ?? '');
    setWpPostTitle(annotation?.wp_post_title ?? '');
    setFormError('');
    setCanonicalUrlError('');
    setEditingRowKey(item.rowKey);
  }, []);

  const closeEdit = React.useCallback(() => {
    setEditingRowKey(null);
    setForm(createEmptyForm());
    setCanonicalUrl('');
    setCanonicalUrlError('');
    setFormError('');
    setWpPostTitle('');
  }, []);

  const handleSave = React.useCallback(
    (annotationId: string | null | undefined) => {
      if (!annotationId) {
        setFormError('アノテーションIDが取得できません');
        return;
      }

      startEditTransition(async () => {
        setFormError('');
        const toastId = toast.loading('保存中です...');
        try {
          // コンテンツフィールドを保存
          const result = await updateContentAnnotationFields(annotationId, {
            ...form,
            canonical_url: canonicalUrl || null,
          });

          if (!result.success) {
            const message = result.error || '保存に失敗しました';
            toast.error(message, { id: toastId });
            setFormError(message);
            return;
          }

          toast.success('保存しました', { id: toastId });
          closeEdit();
          router.refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'エラーが発生しました';
          toast.error(message, { id: toastId });
          setFormError(message);
        }
      });
    },
    [canonicalUrl, closeEdit, form, router]
  );

  const handleDeleteClick = React.useCallback(
    (item: AnalyticsContentItem) => {
      if (isReadOnly) return;
      const annotation = item.annotation;
      const sessionId = annotation?.session_id;
      const annotationId = annotation?.id;

      if (!sessionId && !annotationId) {
        toast.error('削除対象のIDが見つかりません');
        return;
      }

      const title = annotation?.wp_post_title || annotation?.main_kw || 'コンテンツ';
      setDeleteTargetTitle(title);
      setDeleteTargetSessionId(sessionId ?? null);
      setDeleteTargetAnnotationId(annotationId ?? null);
      setHasOrphanContent(!sessionId);
      setDeletingRowKey(item.rowKey);
      setDeleteDialogOpen(true);
    },
    [isReadOnly]
  );

  const handleDeleteConfirm = React.useCallback(async () => {
    setIsDeleting(true);
    const toastId = toast.loading('削除中です...');

    try {
      if (deleteTargetSessionId) {
        // session_id がある場合: チャットとコンテンツを削除
        if (!chatServiceRef.current) {
          throw new Error('ChatService が初期化されていません');
        }
        await chatServiceRef.current.deleteSession(deleteTargetSessionId);
      } else if (deleteTargetAnnotationId) {
        // session_id がない場合: コンテンツのみ削除
        const result = await deleteContentAnnotation(deleteTargetAnnotationId);
        if (!result.success) {
          throw new Error(result.error || 'コンテンツの削除に失敗しました');
        }
      } else {
        throw new Error('削除対象のIDが見つかりません');
      }

      toast.success('削除しました', { id: toastId });
      setDeleteDialogOpen(false);
      setDeleteTargetSessionId(null);
      setDeleteTargetAnnotationId(null);
      setDeleteTargetTitle('');
      setHasOrphanContent(false);
      setDeletingRowKey(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '削除に失敗しました';
      toast.error(message, { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTargetSessionId, deleteTargetAnnotationId, router]);

  return (
    <>
      <FieldConfigurator
        storageKey={ANALYTICS_STORAGE_KEYS.VISIBLE_COLUMNS}
        columns={ANALYTICS_COLUMNS}
        hideTrigger
        triggerId="analytics-field-config-trigger"
        dialogExtraContent={
          <CategoryFilter
            categories={allCategories}
            selectedCategoryNames={categoryFilterNames}
            includeUncategorized={includeUncategorized}
            onFilterChange={handleCategoryFilterChange}
          />
        }
      >
        {({ visibleSet, orderedIds }) => (
          <div className="w-full">
            {/* フィルター情報と件数表示 */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2 flex-wrap">
                {hasActiveFilters && (
                  <>
                    <span className="text-sm text-gray-500">フィルター:</span>
                    {selectedCategoryInfo.map(cat => (
                      <span
                        key={cat}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-gray-700 bg-gray-100"
                      >
                        {cat}
                        <button
                          type="button"
                          onClick={() => removeCategoryFilter(cat)}
                          className="hover:bg-gray-200 rounded-full p-0.5"
                          title={`${cat}を解除`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {includeUncategorized && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-gray-700 bg-gray-200">
                        未分類
                        <button
                          type="button"
                          onClick={removeUncategorizedFilter}
                          className="hover:bg-gray-300 rounded-full p-0.5"
                          title="未分類を解除"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      クリア
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[2200px] divide-y divide-gray-200">
                <thead className="bg-gray-50 analytics-head">
                  <tr>
                    <th
                      className="analytics-ops-cell px-2 py-3 text-center text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap relative group/th"
                      style={{
                        width: `${opsWidth}px`,
                        minWidth: `${opsWidth}px`,
                        maxWidth: `${opsWidth}px`,
                        transition: 'width 0.2s ease-in-out',
                      }}
                    >
                      <div className="flex items-center justify-center relative w-full">
                        <span>操作</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6 ml-2 text-gray-500 hover:text-gray-700 bg-white border-gray-300 shadow-sm"
                          onClick={toggleOpsExpanded}
                          title={isOpsExpanded ? '操作列を折りたたむ' : '操作列を展開する'}
                        >
                          {isOpsExpanded ? (
                            <ChevronsLeft className="h-4 w-4" />
                          ) : (
                            <ChevronsRight className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </th>
                    {orderedIds
                      .filter(id => visibleSet.has(id))
                      .map(id => (
                        <th
                          key={id}
                          className={`px-6 py-3 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap ${
                            id === 'impressions' ? 'text-right min-w-[120px]' : ''
                          } ${id === 'categories' ? 'min-w-[200px]' : ''} ${
                            id === 'wp_post_title' || id === 'wp_excerpt' ? 'min-w-[360px]' : ''
                          } ${id === 'url' ? 'min-w-[300px]' : ''} ${
                            ['main_kw', 'kw'].includes(id) ? 'min-w-[180px]' : ''
                          } ${
                            [
                              'ga4_avg_engagement_time',
                              'ga4_read_rate',
                              'ga4_bounce_rate',
                              'ga4_cv_count',
                              'ga4_cvr',
                              'ga4_flags',
                            ].includes(id)
                              ? 'min-w-[140px]'
                              : ''
                          } ${['needs', 'persona', 'goal', 'prep', 'basic_structure', 'opening_proposal'].includes(id) ? 'min-w-[220px]' : ''} ${
                            id === 'date' ? 'min-w-[120px]' : ''
                          }`}
                        >
                          {columnLabelMap[id]}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredItems.map(item => {
                    const annotation = item.annotation;
                    const ga4Summary = item.ga4Summary ?? null;
                    const wpPostId =
                      annotation?.wp_post_id != null && Number.isFinite(annotation.wp_post_id)
                        ? annotation.wp_post_id
                        : null;
                    const fallbackTitle =
                      annotation?.wp_post_title || annotation?.main_kw || 'コンテンツチャット';
                    const rowCanonicalUrl = annotation?.canonical_url ?? null;
                    const updatedAt = annotation?.updated_at
                      ? new Date(annotation.updated_at).toLocaleDateString('ja-JP')
                      : null;
                    const hasUnreadSuggestion = annotation?.id
                      ? (unreadAnnotationIds?.has(annotation.id) ?? false)
                      : false;
                    const avgEngagementSeconds =
                      ga4Summary && ga4Summary.sessions > 0
                        ? ga4Summary.engagementTimeSec / ga4Summary.sessions
                        : 0;
                    const readRate =
                      ga4Summary && ga4Summary.users > 0
                        ? ga4Summary.scroll90EventCount / ga4Summary.users
                        : 0;
                    const cvr =
                      ga4Summary && ga4Summary.users > 0
                        ? ga4Summary.cvEventCount / ga4Summary.users
                        : 0;

                    return (
                      <tr key={item.rowKey} className="analytics-row group">
                        <td
                          className="analytics-ops-cell px-2 py-4 whitespace-nowrap text-sm text-center relative"
                          style={{
                            width: `${opsWidth}px`,
                            minWidth: `${opsWidth}px`,
                            maxWidth: `${opsWidth}px`,
                          }}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <LaunchChatButton
                              label="チャット"
                              isPending={pendingRowKey === item.rowKey}
                              onClick={() => {
                                const hasExistingBlog =
                                  (rowCanonicalUrl && rowCanonicalUrl.trim().length > 0) ||
                                  (typeof wpPostId === 'number' && Number.isFinite(wpPostId));
                                handleLaunch({
                                  rowKey: item.rowKey,
                                  sessionId: annotation?.session_id ?? null,
                                  annotationId: annotation?.id ?? null,
                                  wpPostId,
                                  wpPostTitle: annotation?.wp_post_title ?? null,
                                  canonicalUrl: rowCanonicalUrl,
                                  fallbackTitle,
                                  initialStep: hasExistingBlog ? 'step7' : null,
                                });
                              }}
                            />

                            {isOpsExpanded && (
                              <>
                                <Dialog
                                  open={editingRowKey === item.rowKey}
                                  onOpenChange={open => {
                                    if (open) {
                                      openEdit(item);
                                    } else {
                                      closeEdit();
                                    }
                                  }}
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex items-center gap-2"
                                    >
                                      <Edit className="h-4 w-4" />
                                      編集
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                                    <DialogHeader>
                                      <DialogTitle>コンテンツ情報を編集</DialogTitle>
                                      <DialogDescription>
                                        テーブルの各フィールドを直接編集し、保存できます。
                                      </DialogDescription>
                                    </DialogHeader>

                                    {formError ? (
                                      <Alert variant="destructive" className="mb-4">
                                        <AlertTitle className="text-sm font-semibold">
                                          保存に失敗しました
                                        </AlertTitle>
                                        <AlertDescription className="text-sm">
                                          {formError}
                                        </AlertDescription>
                                      </Alert>
                                    ) : null}

                                    <AnnotationFormFields
                                      form={form}
                                      onFormChange={(key, value) =>
                                        setForm(prev => ({ ...prev, [key]: value }))
                                      }
                                      canonicalUrl={canonicalUrl}
                                      onCanonicalUrlChange={value => {
                                        setCanonicalUrl(value);
                                        if (canonicalUrlError) setCanonicalUrlError('');
                                      }}
                                      canonicalUrlError={canonicalUrlError}
                                      wpPostTitle={wpPostTitle}
                                    />

                                    <DialogFooter>
                                      <Button
                                        variant="ghost"
                                        onClick={closeEdit}
                                        disabled={isPendingEdit}
                                      >
                                        キャンセル
                                      </Button>
                                      <Button
                                        onClick={() => handleSave(annotation?.id)}
                                        disabled={isPendingEdit}
                                      >
                                        {isPendingEdit ? (
                                          <>
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            保存中...
                                          </>
                                        ) : (
                                          '保存'
                                        )}
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>

                                {annotation?.id ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-2"
                                    onClick={() => {
                                      const target = new URLSearchParams();
                                      target.set('annotationId', annotation.id ?? '');
                                      window.open(
                                        `/gsc-dashboard?${target.toString()}`,
                                        '_blank',
                                        'noopener,noreferrer'
                                      );
                                    }}
                                  >
                                    <span className="inline-flex h-3 w-3 items-center justify-center">
                                      {hasUnreadSuggestion ? (
                                        <span
                                          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-600 animate-pulse"
                                          title="改善提案があります"
                                        >
                                          <Bell className="h-3.5 w-3.5" />
                                        </span>
                                      ) : (
                                        <FileText
                                          className="h-3.5 w-3.5 text-gray-500"
                                          aria-hidden
                                        />
                                      )}
                                    </span>
                                    <span>詳細</span>
                                  </Button>
                                ) : null}

                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                  onClick={() => handleDeleteClick(item)}
                                  disabled={
                                    isReadOnly || (isDeleting && deletingRowKey === item.rowKey)
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                  削除
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                        {orderedIds
                          .filter(id => visibleSet.has(id))
                          .map(id => {
                            switch (id) {
                              case 'main_kw':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.main_kw ? (
                                      <TruncatedText text={annotation.main_kw} lines={2} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'kw':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.kw ? (
                                      <TruncatedText text={annotation.kw} lines={2} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'impressions':
                                return (
                                  <td
                                    key={id}
                                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right"
                                  >
                                    {annotation?.impressions ?? '—'}
                                  </td>
                                );
                              case 'ga4_avg_engagement_time':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? formatSeconds(avgEngagementSeconds) : '—'}
                                  </td>
                                );
                              case 'ga4_read_rate':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? formatPercent(readRate) : '—'}
                                  </td>
                                );
                              case 'ga4_bounce_rate':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? formatPercent(ga4Summary.bounceRate) : '—'}
                                  </td>
                                );
                              case 'ga4_cv_count':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? ga4Summary.cvEventCount : '—'}
                                  </td>
                                );
                              case 'ga4_cvr':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? formatPercent(cvr) : '—'}
                                  </td>
                                );
                              case 'ga4_flags':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {ga4Summary ? (
                                      <div className="flex flex-wrap gap-2">
                                        {ga4Summary.isSampled && (
                                          <Badge variant="outline">サンプリング</Badge>
                                        )}
                                        {ga4Summary.isPartial && (
                                          <Badge variant="outline">部分取得</Badge>
                                        )}
                                        {!ga4Summary.isSampled && !ga4Summary.isPartial && (
                                          <span className="text-xs text-gray-500">正常</span>
                                        )}
                                      </div>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'needs':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.needs ? (
                                      <TruncatedText text={annotation.needs} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'persona':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.persona ? (
                                      <TruncatedText text={annotation.persona} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'goal':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.goal ? (
                                      <TruncatedText text={annotation.goal} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'prep':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.prep ? (
                                      <TruncatedText text={annotation.prep} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'basic_structure':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.basic_structure ? (
                                      <TruncatedText text={annotation.basic_structure} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'opening_proposal':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.opening_proposal ? (
                                      <TruncatedText text={annotation.opening_proposal} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'categories': {
                                const itemCats = annotation?.wp_category_names ?? [];
                                return (
                                  <td key={id} className="px-6 py-4 text-sm">
                                    {itemCats.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {itemCats.map(cat => (
                                          <span
                                            key={cat}
                                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-gray-700 bg-gray-100"
                                          >
                                            {cat}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">未分類</span>
                                    )}
                                  </td>
                                );
                              }
                              case 'date':
                                return (
                                  <td
                                    key={id}
                                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                  >
                                    {updatedAt ?? '—'}
                                  </td>
                                );
                              case 'wp_post_title':
                                return (
                                  <td
                                    key={id}
                                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                  >
                                    {annotation?.wp_post_title || '—'}
                                  </td>
                                );
                              case 'wp_excerpt':
                                return (
                                  <td key={id} className="px-6 py-4 text-sm text-gray-900">
                                    {annotation?.wp_excerpt ? (
                                      <TruncatedText text={annotation.wp_excerpt} lines={3} />
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              case 'url':
                                return (
                                  <td
                                    key={id}
                                    className="px-6 py-4 whitespace-nowrap text-sm text-blue-600"
                                  >
                                    {rowCanonicalUrl ? (
                                      <a
                                        href={rowCanonicalUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline"
                                      >
                                        {rowCanonicalUrl}
                                      </a>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                );
                              default:
                                return null;
                            }
                          })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </FieldConfigurator>
      <DeleteChatDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        chatTitle={deleteTargetTitle}
        isDeleting={isDeleting}
        mode="content"
        hasOrphanContent={hasOrphanContent}
      />
    </>
  );
}
