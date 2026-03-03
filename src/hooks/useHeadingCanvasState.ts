import { useState, useCallback, useEffect } from 'react';
import { saveHeadingSection, resetHeadingSections } from '@/server/actions/heading-flow.actions';
import { toast } from 'sonner';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

import { SessionHeadingSection } from '@/types/heading-flow';

interface UseHeadingCanvasStateProps {
  sessionId: string;
  getAccessToken: () => Promise<string>;
  initialSections: SessionHeadingSection[];
  onHeadingSaved: () => Promise<void | unknown>;
  onResetComplete: () => Promise<void | unknown>;
}

export function useHeadingCanvasState({
  sessionId,
  getAccessToken,
  initialSections,
  onHeadingSaved,
  onResetComplete,
}: UseHeadingCanvasStateProps) {
  const [viewingHeadingIndex, setViewingHeadingIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sections, setSections] = useState<SessionHeadingSection[]>(initialSections);

  useEffect(() => {
    setSections(initialSections);
  }, [initialSections]);

  const currentHeading = viewingHeadingIndex !== null ? sections[viewingHeadingIndex] : null;

  const handleSaveHeadingSection = useCallback(
    async (content: string, overrideHeadingKey?: string) => {
      const targetHeading = overrideHeadingKey
        ? sections.find(s => s.headingKey === overrideHeadingKey)
        : currentHeading;
      if (!targetHeading) return;

      setIsSaving(true);
      try {
        const token = await getAccessToken();
        if (!sessionId || !token) {
          toast.error(ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED);
          return;
        }

        const res = await saveHeadingSection({
          sessionId,
          headingKey: targetHeading.headingKey,
          content,
          liffAccessToken: token,
        });

        if (res.success) {
          toast.success('見出し本文を保存しました');

          const wasConfirmed = targetHeading.isConfirmed;
          await onHeadingSaved();

          // 表示中の見出しを保存した場合のみ次へ進む。override 時（StepActionBar 保存）は表示は変更しない
          if (!overrideHeadingKey && !wasConfirmed && viewingHeadingIndex !== null) {
            if (viewingHeadingIndex === sections.length - 1) {
              setViewingHeadingIndex(null);
            } else {
              setViewingHeadingIndex(viewingHeadingIndex + 1);
            }
          }
        } else {
          toast.error(res.error || ERROR_MESSAGES.COMMON.SAVE_FAILED);
        }
      } catch (err) {
        console.error('Failed to save heading section:', err);
        toast.error(ERROR_MESSAGES.COMMON.NETWORK_ERROR);
      } finally {
        setIsSaving(false);
      }
    },
    [
      sessionId,
      getAccessToken,
      viewingHeadingIndex,
      currentHeading,
      sections,
      onHeadingSaved,
    ]
  );

  const handleResetHeadingConfiguration = useCallback(
    async (options?: { preserveStep7Lead?: boolean }): Promise<boolean> => {
      try {
        const token = await getAccessToken();
        if (!sessionId || !token) {
          toast.error(ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED);
          return false;
        }

        const res = await resetHeadingSections({
          sessionId,
          liffAccessToken: token,
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
    [sessionId, getAccessToken, onResetComplete]
  );

  return {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    currentHeading,
    sections,
    isSaving,
    handleSaveHeadingSection,
    handleResetHeadingConfiguration,
  };
}
