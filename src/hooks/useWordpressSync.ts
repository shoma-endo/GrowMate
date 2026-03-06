import { useState, useEffect, useCallback } from 'react';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import { AnnotationRecord } from '@/types/annotation';
import { BlogStepId } from '@/lib/constants';

export function useWordpressSync({
  currentSessionId,
  getAccessToken,
  loadSession,
  setFollowLatestByStep,
  setSelectedVersionByStep,
}: {
  currentSessionId: string | undefined | null;
  getAccessToken: () => Promise<string | null>;
  loadSession: (sessionId: string) => Promise<void>;
  setFollowLatestByStep: React.Dispatch<React.SetStateAction<Partial<Record<BlogStepId, boolean>>>>;
  setSelectedVersionByStep: React.Dispatch<
    React.SetStateAction<Partial<Record<BlogStepId, string | null>>>
  >;
}) {
  const [annotationData, setAnnotationData] = useState<AnnotationRecord | null>(null);
  const [annotationLoading, setAnnotationLoading] = useState(false);

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    let isActive = true;

    const loadAnnotations = async () => {
      try {
        const res = await getContentAnnotationBySession(currentSessionId);
        if (!isActive) return;

        if (res.success && res.data) {
          setAnnotationData(res.data);
        } else {
          setAnnotationData(null);
        }
      } catch (error) {
        console.error('Failed to preload annotation data:', error);
      }
    };

    loadAnnotations();

    return () => {
      isActive = false;
    };
  }, [currentSessionId]);

  const handleLoadBlogArticle = useCallback(async () => {
    if (!currentSessionId) {
      throw new Error('セッションが選択されていません');
    }
    try {
      const annotationRes = await getContentAnnotationBySession(currentSessionId);
      if (!annotationRes.success) {
        throw new Error(annotationRes.error || 'ブログ記事情報の取得に失敗しました');
      }

      const latestAnnotation = annotationRes.data ?? null;
      setAnnotationData(latestAnnotation);

      const canonicalUrl = latestAnnotation?.canonical_url?.trim() ?? '';
      if (!canonicalUrl) {
        throw new Error('ブログ記事URLが登録されていません');
      }

      const accessToken = await getAccessToken();
      const response = await fetch('/api/chat/canvas/load-wordpress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
        credentials: 'include',
      });

      const responseData: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null);

      if (!response.ok || !responseData?.success) {
        const message =
          (responseData && typeof responseData.error === 'string' && responseData.error.length > 0
            ? responseData.error
            : null) ?? 'WordPress記事の取得に失敗しました';
        throw new Error(message);
      }

      await loadSession(currentSessionId);
      setFollowLatestByStep(prev => ({
        ...prev,
        step7: true,
      }));
      setSelectedVersionByStep(prev => ({
        ...prev,
        step7: null,
      }));
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('WordPress記事の取得に失敗しました');
    }
  }, [
    currentSessionId,
    getAccessToken,
    loadSession,
    setFollowLatestByStep,
    setSelectedVersionByStep,
  ]);

  return {
    annotationData,
    setAnnotationData,
    annotationLoading,
    setAnnotationLoading,
    handleLoadBlogArticle,
  };
}
