'use client';

import React from 'react';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import type { AdminUserListItem } from '@/types/user';

type DeleteUserDialogProps = {
  user: AdminUserListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDeleting?: boolean;
};

function buildTargetSummary(user: AdminUserListItem): string {
  const parts: string[] = [];
  if (user.fullName) {
    parts.push(user.fullName);
  }
  if (user.email) {
    parts.push(user.email);
  }
  if (user.lineDisplayName) {
    parts.push(user.lineDisplayName);
  }
  return parts.join(' / ');
}

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  isDeleting = false,
}: DeleteUserDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (isDeleting && !next) {
      return;
    }
    onOpenChange(next);
  };

  const targetSummary = user ? buildTargetSummary(user) : '';

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={handleOpenChange}
      onConfirm={() => {}}
      isDeleting={isDeleting}
      confirmDisabled
      title="ユーザーを完全に削除しますか？"
      description={
        <>
          {targetSummary && <p>{targetSummary}</p>}
          <p className="mt-3">
            認証情報と関連データが削除されます。取り消しや復元はできません。
          </p>
          <p className="mt-2">
            同じメールアドレスやLINEアカウントで、後日新規登録することはできます。
          </p>
        </>
      }
    />
  );
}
