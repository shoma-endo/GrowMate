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

  const handlePrevHeading = useCallback(() => {
    if (viewingHeadingIndex === null) {
      if (sections.length > 0) {
        setViewingHeadingIndex(sections.length - 1);
      }
      return;
    }
    if (viewingHeadingIndex > 0) {
      setViewingHeadingIndex(viewingHeadingIndex - 1);
    }
  }, [viewingHeadingIndex, sections.length]);

  const handleNextHeading = useCallback(() => {
    if (viewingHeadingIndex === null) return;
    if (viewingHeadingIndex < sections.length - 1) {
      setViewingHeadingIndex(viewingHeadingIndex + 1);
    } else {
      // 最終見出しの場合は完成形表示(null)へ戻す
      setViewingHeadingIndex(null);
    }
  }, [viewingHeadingIndex, sections.length]);

  const handleSaveHeadingSection = useCallback(
    async (content: string) => {
      if (viewingHeadingIndex === null || !currentHeading) return;

      setIsSaving(true);
      try {
        const token = await getAccessToken();
        if (!sessionId || !token) {
          toast.error(ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED);
          return;
        }

        const res = await saveHeadingSection({
          sessionId,
          headingKey: currentHeading.headingKey,
          content,
          liffAccessToken: token,
        });

        if (res.success) {
          toast.success('見出し本文を保存しました');

          const wasConfirmed = currentHeading.isConfirmed;
          await onHeadingSaved();

          // 未確定の状態から保存した場合のみ次へ進む（再編集時はその場に留まる）
          if (!wasConfirmed) {
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
      sections.length,
      onHeadingSaved,
    ]
  );

  const handleResetHeadingConfiguration = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      if (!sessionId || !token) {
        toast.error(ERROR_MESSAGES.AUTH.REAUTHENTICATION_REQUIRED);
        return false;
      }

      const res = await resetHeadingSections({
        sessionId,
        liffAccessToken: token,
      });

      if (res.success) {
        toast.info('見出し構成をリセットしました。見出しを再抽出しています…');
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
  }, [sessionId, getAccessToken, onResetComplete]);

  return {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    currentHeading,
    sections,
    isSaving,
    handlePrevHeading,
    handleNextHeading,
    handleSaveHeadingSection,
    handleResetHeadingConfiguration,
  };
}
