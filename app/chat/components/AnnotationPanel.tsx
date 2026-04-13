'use client';

import React from 'react';
import {
  upsertContentAnnotationBySession,
} from '@/server/actions/wordpress.actions';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersistedResizableWidth } from '@/hooks/usePersistedResizableWidth';
import { AnnotationRecord } from '@/types/annotation';
import AnnotationFormFields from '@/components/AnnotationFormFields';
import { useAnnotationForm } from '@/hooks/useAnnotationForm';

interface Props {
  sessionId: string;
  initialData?: AnnotationRecord | null;
  onClose: () => void;
  isVisible?: boolean;
  onSaveSuccess?: () => void;
}

export default function AnnotationPanel({
  sessionId,
  initialData,
  onClose,
  isVisible = true,
  onSaveSuccess,
}: Props) {
  const {
    form,
    updateField,
    canonicalUrl,
    updateCanonicalUrl,
    canonicalUrlError,
    isSaving,
    saveDone,
    wpPostTitle,
    submit,
  } = useAnnotationForm({
    initialFields: initialData ?? null,
    initialCanonicalUrl: initialData?.canonical_url ?? null,
    initialWpPostTitle: initialData?.wp_post_title ?? null,
    onSubmit: ({ fields, canonicalUrl }) =>
      upsertContentAnnotationBySession({
        session_id: sessionId,
        ...fields,
        canonical_url: canonicalUrl,
      }),
  });
  const { width: panelWidth, isResizing, handleMouseDown } = usePersistedResizableWidth({
    storageKey: 'chat-right-panel-width',
    defaultWidth: 450,
    minWidth: 320,
    maxWidth: 1000,
  });

  const handleSave = async () => {
    const result = await submit();
    if (!result.success) {
      return;
    }

    onSaveSuccess?.();
  };
  if (!isVisible) return null;

  return (
    <div
      className={cn('h-full bg-gray-50 border-l flex flex-col relative')}
      style={{ width: panelWidth }}
    >
      {/* リサイザーハンドル - 固定ヘッダー下から開始 */}
      <div
        className={`absolute left-0 top-16 bottom-0 w-1 cursor-col-resize transition-all duration-200 group ${
          isResizing ? 'bg-blue-500 w-2 shadow-lg' : 'bg-gray-200 hover:bg-blue-300 hover:w-1.5'
        }`}
        onMouseDown={handleMouseDown}
        style={{ zIndex: 45 }} // ヘッダーより少し下のz-index
        title="ドラッグして幅を調整"
      >
        {/* リサイザーハンドルの視覚的ヒント */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-0.5 h-8 bg-white/70 rounded-full"></div>
        </div>
      </div>

      {/* ヘッダー部分 - 固定ヘッダー分のtop位置を調整 */}
      <div className="sticky top-16 z-40 flex items-center justify-between px-4 py-3 border-b bg-white/90 backdrop-blur-sm ml-2 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <h3 className="text-lg font-semibold text-gray-800">メモ・補足情報</h3>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="w-8 h-8 hover:bg-red-100 hover:text-red-600 transition-colors"
          title="パネルを閉じる"
        >
          <X size={16} />
        </Button>
      </div>

      {/* コンテンツエリア - ヘッダーとの重なりを防ぐため上部パディングを調整 */}
      <div className="flex-1 overflow-auto p-4 ml-2" style={{ paddingTop: '80px' }}>
        <div className="space-y-5">
          <fieldset>
            <AnnotationFormFields
              form={form}
              onFormChange={updateField}
              canonicalUrl={canonicalUrl}
              onCanonicalUrlChange={updateCanonicalUrl}
              canonicalUrlError={canonicalUrlError}
              canonicalUrlInputId="panel-wp-canonical-url"
              wpPostTitle={wpPostTitle}
            />
          </fieldset>

          {/* アクションボタン */}
          <div className="pt-4 border-t border-gray-200">
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={isSaving || saveDone}
              >
                キャンセル
              </Button>
              <div className="relative">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || saveDone}
              >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      保存中...
                    </>
                  ) : saveDone ? (
                    '保存完了'
                  ) : (
                    '保存'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
