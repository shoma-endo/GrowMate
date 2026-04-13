import { useState, useCallback } from 'react';
import { resetHeadingSections } from '@/server/actions/heading-flow.actions';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { SessionHeadingSection } from '@/types/heading-flow';

interface UseHeadingCanvasStateProps {
  sessionId: string;
  /** 互換性のため残す。未使用（headingSections は useHeadingFlow から取得） */
  initialSections?: SessionHeadingSection[];
  /** 互換性のため残す。未使用（保存後のコールバックは ChatLayout で handleSaveHeadingSectionFromFlow に連携） */
  onHeadingSaved?: () => Promise<void | unknown>;
  onResetComplete: () => Promise<void | unknown>;
}

/** 見出し Canvas の表示インデックスとリセットのみを管理。保存処理は useHeadingFlow が担当。 */
export function useHeadingCanvasState({
  sessionId,
  onResetComplete,
}: UseHeadingCanvasStateProps) {
  const [viewingHeadingIndex, setViewingHeadingIndex] = useState<number | null>(null);

  const handleResetHeadingConfiguration = useCallback(
    async (options?: { preserveStep7Lead?: boolean }): Promise<boolean> => {
      try {
        if (!sessionId) {
          toast.error(ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED);
          return false;
        }

        const res = await resetHeadingSections({
          sessionId,
          preserveStep7Lead: options?.preserveStep7Lead,
        });

        if (res.success) {
          toast.info(
            options?.preserveStep7Lead
              ? '見出し構成をリセットしました。見出し生成ボタンで1つ目の見出しを生成してください。'
              : '見出し構成をリセットしました。見出しを再抽出しています…'
          );
          setViewingHeadingIndex(null);
          await onResetComplete();
          return true;
        } else {
          toast.error(res.error || ERROR_MESSAGES.COMMON.UPDATE_FAILED);
          return false;
        }
      } catch (err) {
        console.error('Failed to reset heading configuration:', err);
        toast.error(ERROR_MESSAGES.COMMON.NETWORK_ERROR);
        return false;
      }
    },
    [sessionId, onResetComplete]
  );

  return {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    handleResetHeadingConfiguration,
  };
}
