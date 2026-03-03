import { useState, useEffect, useCallback } from 'react';
import { ChatSessionHook } from '@/hooks/useChatSession';
import { validateTitle } from '@/lib/validators/common';
import { getLatestBlogStep7MessageBySession } from '@/server/actions/chat.actions';
import { getLatestCombinedContent } from '@/server/actions/heading-flow.actions';

const TITLE_META_SYSTEM_PROMPT =
  '本文を元にタイトル（全角32文字以内で狙うキーワードはなるべく左よせ）、説明文（全角80文字程度）を３パターン作成してください';

export function useSessionTitle({
  chatSession,
  getAccessToken,
}: {
  chatSession: ChatSessionHook;
  getAccessToken: () => Promise<string | null>;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isGeneratingTitleMeta, setIsGeneratingTitleMeta] = useState(false);

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

  const handleGenerateTitleMeta = async () => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId) return;
    setIsGeneratingTitleMeta(true);
    try {
      const accessToken = await getAccessToken();
      let bodyContent: string | null = null;

      const res = await getLatestBlogStep7MessageBySession(sessionId, accessToken ?? "");
      if (!res.success) {
        chatSession.actions.setError(res.error || '本文の取得に失敗しました');
        return;
      }
      if (res.data?.content?.trim()) {
        bodyContent = res.data.content;
      }

      if (!bodyContent) {
        const combinedRes = await getLatestCombinedContent({
          sessionId,
          liffAccessToken: accessToken ?? "",
        });
        if (combinedRes.success && combinedRes.data?.trim()) {
          bodyContent = combinedRes.data;
        }
      }

      if (!bodyContent?.trim()) {
        chatSession.actions.setError('本文が見つかりませんでした');
        return;
      }

      const systemPrompt = `${TITLE_META_SYSTEM_PROMPT}\n\n本文:\n${bodyContent}`;
      await chatSession.actions.sendMessage(
        '本文を元にタイトルと説明文を作成してください。',
        'blog_title_meta_generation',
        { systemPrompt }
      );
    } catch (error) {
      console.error('Failed to generate title/meta:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'タイトル・説明文の生成に失敗しました';
      chatSession.actions.setError(errorMessage);
    } finally {
      setIsGeneratingTitleMeta(false);
    }
  };

  return {
    isEditingTitle,
    draftTitle,
    titleError,
    isSavingTitle,
    isGeneratingTitleMeta,
    handleTitleEditStart,
    handleTitleEditChange,
    handleTitleEditCancel,
    handleTitleEditConfirm,
    handleGenerateTitleMeta,
  };
}
