'use client';

import React from 'react';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { DeleteChatDialogProps } from '@/types/components';

export function DeleteChatDialog({
  open,
  onOpenChange,
  onConfirm,
  chatTitle,
  isDeleting = false,
  mode = 'chat',
  hasOrphanContent = false,
}: DeleteChatDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const isContentMode = mode === 'content';

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={handleConfirm}
      isDeleting={isDeleting}
      title={isContentMode ? 'コンテンツを削除' : 'チャットを削除'}
      description={
        <>
          「{chatTitle}」を削除してもよろしいですか？
          <br />
          <span className="text-red-600 font-medium">この操作は取り消すことができません。</span>
          <div className="mt-3 text-xs text-gray-600 space-y-1">
            {isContentMode ? (
              hasOrphanContent ? (
                <p className="text-amber-600 font-medium">
                  ・紐づくチャットがないため、コンテンツのみ削除されます。
                </p>
              ) : (
                <>
                  <p className="text-red-600 font-medium">
                    ・このコンテンツに紐づくチャットも同時に削除されます。
                  </p>
                  <p>・チャットメッセージもすべて削除されます。</p>
                </>
              )
            ) : (
              <>
                <p className="text-red-600 font-medium">
                  ・このチャットに紐づくコンテンツ情報も同時に削除されます。
                </p>
                <p>・チャットメッセージもすべて削除されます。</p>
              </>
            )}
          </div>
        </>
      }
    />
  );
}
