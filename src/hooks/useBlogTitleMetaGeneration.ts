import { useRef, useState } from 'react';
import { ChatSessionHook } from '@/hooks/useChatSession';
import { ANALYTICS_COLUMNS } from '@/lib/constants';
import { AnnotationFieldKey } from '@/types/annotation';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';

const REQUIRED_ANNOTATION_FIELDS: AnnotationFieldKey[] = ['main_kw', 'kw', 'persona'];

const REQUIRED_FIELD_LABELS = REQUIRED_ANNOTATION_FIELDS.reduce<Record<AnnotationFieldKey, string>>(
  (acc, key) => {
    acc[key] = ANALYTICS_COLUMNS.find(column => column.id === key)?.label ?? key;
    return acc;
  },
  {} as Record<AnnotationFieldKey, string>
);

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
      const annotationResult = await getContentAnnotationBySession(sessionId);
      if (!annotationResult.success) {
        if (isEmailLinkConflictResult(annotationResult)) {
          replaceToEmailLinkConflictLogin();
          return;
        }
        chatSession.actions.setError(annotationResult.error);
        return;
      }
      const annotation = annotationResult.data;

      const missingFields: string[] = [];
      if (!annotation?.main_kw) missingFields.push(REQUIRED_FIELD_LABELS.main_kw);
      if (!annotation?.kw) missingFields.push(REQUIRED_FIELD_LABELS.kw);
      if (!annotation?.persona) missingFields.push(REQUIRED_FIELD_LABELS.persona);

      if (missingFields.length > 0) {
        chatSession.actions.addSystemMessage(
          `タイトル・説明文の生成に必要な情報（${missingFields.join('・')}）が未入力です。ブログ保存を開いて情報を入力・保存してください。`
        );
        return;
      }

      await chatSession.actions.sendMessage(
        'タイトルと説明文を生成してください。',
        'blog_title_meta_generation',
        { skipHistory: true, sessionIdOverride: sessionId }
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
