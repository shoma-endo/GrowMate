import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ChatLayoutProps } from '@/types/chat-layout';
import type { BlogStepId } from '@/lib/constants';
import { STEP7_ID } from '@/lib/constants';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { saveStep7UserLead } from '@/server/actions/heading-flow.actions';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import type { AnnotationRecord } from '@/types/annotation';

interface UseBlogFlowControlsParams {
  chatSession: ChatLayoutProps['chatSession'];
  selectedModel: string;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  setNextStepForPlaceholder: Dispatch<SetStateAction<BlogStepId | null>>;
  setIsViewingPastHeadingContent: Dispatch<SetStateAction<boolean>>;
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  setCanvasEditHistory: Dispatch<SetStateAction<{ role: 'user' | 'assistant'; content: string }[]>>;
  setCanvasStep: Dispatch<SetStateAction<BlogStepId | null>>;
  headingSections: SessionHeadingSection[];
  activeHeadingIndex: number | undefined;
  pendingViewingIndexRef: RefObject<number | null>;
  prevSessionIdRef: RefObject<string | null>;
  setCanvasPanelOpen: Dispatch<SetStateAction<boolean>>;
  setAnnotationOpen: Dispatch<SetStateAction<boolean>>;
  setAnnotationData: Dispatch<SetStateAction<AnnotationRecord | null>>;
  setAnnotationLoading: Dispatch<SetStateAction<boolean>>;
  setSelectedVersionByStep: ReturnType<typeof useCanvasVersions>['setSelectedVersionByStep'];
  setFollowLatestByStep: ReturnType<typeof useCanvasVersions>['setFollowLatestByStep'];
  latestBlogStep: BlogStepId | null;
  selectedServiceId: string | null;
}

export function useBlogFlowControls({
  chatSession,
  selectedModel,
  setSelectedModel,
  setNextStepForPlaceholder,
  setIsViewingPastHeadingContent,
  setCanvasStreamingContent,
  setCanvasEditHistory,
  setCanvasStep,
  headingSections,
  activeHeadingIndex,
  pendingViewingIndexRef,
  prevSessionIdRef,
  setCanvasPanelOpen,
  setAnnotationOpen,
  setAnnotationData,
  setAnnotationLoading,
  setSelectedVersionByStep,
  setFollowLatestByStep,
  latestBlogStep,
  selectedServiceId,
}: UseBlogFlowControlsParams) {
  const handleBeforeManualStepChange = useCallback((): boolean => true, []);

  // スキップ/バック時に resolvedCanvasStep を同期（見出しフロー・Canvas コンテンツの表示に必要）
  // Canvas は AI チャット生成時のみ自動オープン。手動スキップでは開かない。
  const handleManualStepChangeForCanvas = useCallback(
    (targetStep: BlogStepId) => {
      setIsViewingPastHeadingContent(false);
      setCanvasStreamingContent('');
      setCanvasEditHistory([]);
      setCanvasStep(targetStep);
      // Step7 へ遷移かつ未確定見出しあり → 完成形ではなく見出し1を表示
      // 完成形は全見出し確定時のみ存在。未確定があれば完成形は存在せず、取得中かどうかに依存しない。
      if (
        targetStep === STEP7_ID &&
        headingSections.length > 0 &&
        activeHeadingIndex !== undefined
      ) {
        pendingViewingIndexRef.current = 0;
      }
    },
    [
      setCanvasStreamingContent,
      setCanvasEditHistory,
      headingSections,
      activeHeadingIndex,
      setIsViewingPastHeadingContent,
      setCanvasStep,
      pendingViewingIndexRef,
    ]
  );

  // 履歴ベースのモデル自動検出は削除（InputArea 側でフロー状態から自動選択）

  // モデル変更ハンドラ
  const handleModelChange = useCallback((model: string, step?: BlogStepId) => {
    void step;
    setSelectedModel(model);
  }, [setSelectedModel]);

  // nextStepの変更ハンドラ
  const handleNextStepChange = useCallback((nextStep: BlogStepId | null) => {
    setNextStepForPlaceholder(nextStep);
  }, [setNextStepForPlaceholder]);

  // BlogFlow起動ガード（モデル選択と連動）
  const blogFlowActive = !!chatSession.state.currentSessionId && selectedModel === 'blog_creation';

  // ✅ セッション切り替え時にパネルを自動的に閉じる
  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current;
    const nextSessionId = chatSession.state.currentSessionId ?? null;
    const shouldResetModel = Boolean(prevSessionId) && prevSessionId !== nextSessionId;

    setCanvasPanelOpen(false);
    setAnnotationOpen(false);
    setAnnotationData(null);
    setAnnotationLoading(false);
    setIsViewingPastHeadingContent(false);
    setCanvasStep(null);
    setCanvasEditHistory([]);
    setSelectedVersionByStep({});
    setFollowLatestByStep({});
    setNextStepForPlaceholder(null);
    // 既存セッション間の切り替え時のみモデル選択をリセット
    if (shouldResetModel) {
      setSelectedModel('');
    }
    prevSessionIdRef.current = nextSessionId;
  }, [
    chatSession.state.currentSessionId,
    setAnnotationData,
    setAnnotationLoading,
    setFollowLatestByStep,
    setSelectedVersionByStep,
    prevSessionIdRef,
    setCanvasPanelOpen,
    setAnnotationOpen,
    setIsViewingPastHeadingContent,
    setCanvasStep,
    setCanvasEditHistory,
    setNextStepForPlaceholder,
    setSelectedModel,
  ]);

  // ✅ メッセージ履歴にブログステップがある場合、自動的にブログ作成モデルを選択
  // セッション切り替え後、latestBlogStepが確定してから実行される
  useEffect(() => {
    // ブログステップが検出された場合
    if (latestBlogStep) {
      // モデルが未選択、またはすでにブログ作成モデルの場合のみ自動選択
      // （ユーザーが明示的に他のモデルを選択した場合は尊重）
      if (!selectedModel || selectedModel === 'blog_creation') {
        setSelectedModel('blog_creation');
      }
    }
  }, [latestBlogStep, selectedModel, setSelectedModel]);

  // ✅ メッセージ送信時に初期化を実行
  const handleSendMessage = useCallback(
    async (content: string, model: string) => {
      // 新規メッセージ送信時はプレースホルダー状態をリセット
      setNextStepForPlaceholder(null);
      // 選択中のサービスIDがあれば常に渡して、セッション更新の競合を避ける
      const options = selectedServiceId ? { serviceId: selectedServiceId } : undefined;

      await chatSession.actions.sendMessage(content, model, options);
    },
    [chatSession.actions, selectedServiceId, setNextStepForPlaceholder]
  );

  /** Step6→Step7: 書き出し案を保存のみ（AI呼び出しなし）。成功時に step7 表示に遷移。 */
  const handleSaveStep7UserLead = useCallback(
    async (userLead: string) => {
      try {
        if (!chatSession.state.currentSessionId) {
          return { success: false, error: 'セッションが見つかりません' };
        }
        // '' は Email ユーザーの有効トークン。Server Action 側が Email セッションで解決する
        const res = await saveStep7UserLead({
          sessionId: chatSession.state.currentSessionId,
          userLead: userLead.trim(),
        });
        if (res.success) {
          await chatSession.actions.loadSession(chatSession.state.currentSessionId);
        }
        return { success: res.success, ...(res.error && { error: res.error }) };
      } catch (error) {
        console.error('Failed to save step7 user lead:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : '保存に失敗しました',
        };
      }
    },
    [chatSession.state.currentSessionId, chatSession.actions]
  );

  return {
    handleBeforeManualStepChange,
    handleManualStepChangeForCanvas,
    handleModelChange,
    handleNextStepChange,
    blogFlowActive,
    handleSendMessage,
    handleSaveStep7UserLead,
  };
}
