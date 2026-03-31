import { useState, useEffect, useCallback } from 'react';
import { ChatSessionHook } from '@/hooks/useChatSession';
import { validateTitle } from '@/lib/validators/common';

export function useSessionTitle({
  chatSession,
}: {
  chatSession: ChatSessionHook;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  const currentSession =
    chatSession.state.sessions.find(s => s.id === chatSession.state.currentSessionId) || null;

  useEffect(() => {
    setIsEditingTitle(false);
    setTitleError(null);
    setIsSavingTitle(false);
  }, [chatSession.state.currentSessionId]);

  useEffect(() => {
    if (!chatSession.state.currentSessionId) {
      setDraftTitle('');
      return;
    }
    if (isEditingTitle) return;
    if (currentSession) {
      setDraftTitle(currentSession.title);
    }
  }, [chatSession.state.currentSessionId, currentSession, isEditingTitle]);

  const handleTitleEditStart = useCallback(() => {
    if (!chatSession.state.currentSessionId || !currentSession) return;
    setDraftTitle(currentSession.title);
    setTitleError(null);
    setIsEditingTitle(true);
  }, [chatSession.state.currentSessionId, currentSession]);

  const handleTitleEditChange = useCallback(
    (value: string) => {
      const sanitized = value.replace(/[\r\n]+/g, '');
      setDraftTitle(sanitized);
      if (titleError) {
        setTitleError(null);
      }
    },
    [titleError]
  );

  const handleTitleEditCancel = useCallback(() => {
    setIsEditingTitle(false);
    setTitleError(null);
    if (currentSession) {
      setDraftTitle(currentSession.title);
    }
  }, [currentSession]);

  const handleTitleEditConfirm = useCallback(async () => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId || !currentSession || isSavingTitle) return;

    const trimmed = draftTitle.trim();
    const validationError = validateTitle(trimmed);
    if (validationError) {
      setTitleError(validationError);
      return;
    }

    if (currentSession.title === trimmed) {
      setIsEditingTitle(false);
      setTitleError(null);
      return;
    }

    setIsSavingTitle(true);
    try {
      await chatSession.actions.updateSessionTitle(sessionId, trimmed);
      setIsEditingTitle(false);
      setTitleError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'タイトルの更新に失敗しました。時間をおいて再試行してください。';
      setTitleError(message);
    } finally {
      setIsSavingTitle(false);
    }
  }, [
    chatSession.actions,
    chatSession.state.currentSessionId,
    currentSession,
    draftTitle,
    isSavingTitle,
  ]);

  return {
    isEditingTitle,
    draftTitle,
    titleError,
    isSavingTitle,
    handleTitleEditStart,
    handleTitleEditChange,
    handleTitleEditCancel,
    handleTitleEditConfirm,
  };
}
