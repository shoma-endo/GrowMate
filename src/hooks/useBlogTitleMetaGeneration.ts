import { useRef, useState } from 'react';
import { ChatSessionHook } from '@/hooks/useChatSession';

export function useBlogTitleMetaGeneration({
  chatSession,
}: {
  chatSession: ChatSessionHook;
}) {
  const [isGeneratingTitleMeta, setIsGeneratingTitleMeta] = useState(false);
  const inFlightRef = useRef(false);

  const handleGenerateTitleMeta = async () => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setIsGeneratingTitleMeta(true);
    try {
      await chatSession.actions.sendMessage(
        'タイトルと説明文を生成してください。',
        'blog_title_meta_generation'
      );
    } catch (error) {
      console.error('Failed to generate title/meta:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'タイトル・説明文の生成に失敗しました';
      chatSession.actions.setError(errorMessage);
    } finally {
      inFlightRef.current = false;
      setIsGeneratingTitleMeta(false);
    }
  };

  return {
    isGeneratingTitleMeta,
    handleGenerateTitleMeta,
  };
}
