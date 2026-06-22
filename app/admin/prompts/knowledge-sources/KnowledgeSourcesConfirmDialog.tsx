'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { KnowledgeSourcesConfirmAction } from './knowledgeSourcesUiUtils';

type KnowledgeSourcesConfirmDialogProps = {
  confirmAction: KnowledgeSourcesConfirmAction | null;
  onClose: () => void;
  onConfirm: () => void;
};

export default function KnowledgeSourcesConfirmDialog({
  confirmAction,
  onClose,
  onConfirm,
}: KnowledgeSourcesConfirmDialogProps) {
  return (
    <Dialog open={confirmAction !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>操作の確認</DialogTitle>
          <DialogDescription>
            {confirmAction?.type === 'create' && 'Google ドキュメントを追加します。'}
            {confirmAction?.type === 'delete' &&
              `「${confirmAction.source.name}」を削除します。この操作は取り消せません。`}
            {confirmAction?.type === 'toggle' &&
              `「${confirmAction.source.name}」を${
                confirmAction.nextActive ? '有効化' : '無効化'
              }します。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="button" onClick={onConfirm}>
            実行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
