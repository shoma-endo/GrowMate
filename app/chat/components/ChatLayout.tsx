'use client';

import dynamic from 'next/dynamic';
import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useServiceSelection } from '@/hooks/useServiceSelection';
import { useStep7HeadingView } from '@/hooks/useStep7HeadingView';
import { useCanvasPanelContent } from '@/hooks/useCanvasPanelContent';
import { useBlogFlowControls } from '@/hooks/useBlogFlowControls';
import { useStep7HeadingActions } from '@/hooks/useStep7HeadingActions';
import { useCanvasSelectionEditStream } from '@/hooks/useCanvasSelectionEditStream';
import { useCanvasNavigation } from '@/hooks/useCanvasNavigation';
import { resolveStep6ToStep7Lead } from '@/lib/step7-lead';
import { useAuth } from '@/components/AuthProvider';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import { findLatestAssistantBlogStep } from '@/lib/canvas-content';
import type { StepActionBarRef } from './StepActionBar';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import {
  BlogStepId,
  BLOG_MODEL_PREFIX,
  STEP7_ID,
  STEP6_ID,
  getStep7HeadingModel,
  toBlogModel,
} from '@/lib/constants';
import { ChatLayoutContent } from './ChatLayoutContent';
import { ChatLayoutProps } from '@/types/chat-layout';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useWordpressSync } from '@/hooks/useWordpressSync';
import { useSessionTitle } from '@/hooks/useSessionTitle';
import { useBlogTitleMetaGeneration } from '@/hooks/useBlogTitleMetaGeneration';

const CanvasPanel = dynamic(() => import('./CanvasPanel'), { ssr: false });

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  chatSession,
  isMobile = false,
  initialStep = null,
}) => {
  // サービス選択ロジックをカスタムフックで管理
  const serviceSelection = useServiceSelection({
    currentSessionId: chatSession.state.currentSessionId,
  });
  const { services, selectedServiceId, servicesError } = serviceSelection.state;
  const { changeService: handleServiceChange, dismissServicesError } = serviceSelection.actions;

  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [canvasStep, setCanvasStep] = useState<BlogStepId | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [nextStepForPlaceholder, setNextStepForPlaceholder] = useState<BlogStepId | null>(null);
  const [canvasStreamingContent, setCanvasStreamingContent] = useState<string>('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [isCanvasStreaming, setIsCanvasStreaming] = useState(false);
  const [canvasEditHistory, setCanvasEditHistory] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);
  const latestBlogStep = useMemo(
    () =>
      findLatestAssistantBlogStep([
        ...(chatSession.state.messages ?? []),
        ...optimisticMessages,
      ]),
    [chatSession.state.messages, optimisticMessages]
  );
  const currentSessionTitle =
    chatSession.state.sessions.find(session => session.id === chatSession.state.currentSessionId)
      ?.title ?? '新しいチャット';
  const canvasEditInFlightRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(null);
  const canvasContentRef = useRef<string>('');
  /** タイルクリック時に指定した見出しインデックスを effect より優先するための ref */
  const pendingViewingIndexRef = useRef<number | null>(null);
  /** hasExactMatch=false 時のフォールバック表示対象 message.id（canvasVersions 反映後に自動解除） */
  const fallbackMessageIdRef = useRef<string | null>(null);
  /** マッピングできない旧形式の Step7 タイル表示中（model に _hN がない等） */
  const [isViewingPastHeadingContent, setIsViewingPastHeadingContent] = useState(false);
  /** Step7 完成形バージョンを表示中 */
  const [isViewingCombinedContent, setIsViewingCombinedContent] = useState(false);
  /** 本文生成（完成形構築）中 */
  const [isBuildingCombined, setIsBuildingCombined] = useState(false);
  /** 本文生成の二重実行防止（state更新遅延より先にブロック） */
  const buildCombinedInFlightRef = useRef(false);
  /** 見出し保存の二重実行防止 */
  const saveHeadingInFlightRef = useRef(false);
  /** 見出し生成トリガー後のストリーミング完了時にCanvas自動オープンするためのフラグ */
  const pendingAutoOpenHeadingRef = useRef(false);
  const prevChatLoadingRef = useRef(false);
  /** 完成形Canvasオープン（handleOpenCombinedCanvas を遅延参照） */
  const openCombinedCanvasRef = useRef<(versionId?: string) => void>(() => {});
  /** 完成形表示を明示的に要求した場合、effect による viewingHeadingIndex 上書きを防止 */
  const requestedCombinedViewRef = useRef(false);
  /** タイルクリック直後の activeVersionId 遅延を補う。Canvas 表示確実化のため保持 */
  const pendingCombinedVersionIdRef = useRef<string | null>(null);
  /** 完成形タイルクリック時に state 更新遅延を補うため、クリック時点で即時解決したコンテンツを保持 */
  const pendingCombinedContentRef = useRef<string | null>(null);

  /** Step6→Step7 で保存済みの書き出し案があるか＋その本文。
   * saved: step7_lead（ユーザー送信）が存在する場合 true。
   * バックで step5 に戻り step6 を再表示した場合、step7_lead より新しい step6 があれば saved=false。 */
  const step6ToStep7Lead = useMemo(
    () =>
      resolveStep6ToStep7Lead([
        ...(chatSession.state.messages ?? []),
        ...optimisticMessages,
      ]),
    [chatSession.state.messages, optimisticMessages]
  );

  const step6ToStep7LeadSaved = step6ToStep7Lead.saved;

  const resolvedCanvasStep = useMemo<BlogStepId | null>(() => {
    if (canvasStep) return canvasStep;
    // step6ToStep7LeadSaved は latestBlogStep が step6 のときのみ step7 にブリッジ
    if (
      step6ToStep7LeadSaved &&
      (latestBlogStep === STEP6_ID || latestBlogStep === null)
    ) {
      return STEP7_ID;
    }
    if (latestBlogStep) return latestBlogStep;
    return null;
  }, [canvasStep, step6ToStep7LeadSaved, latestBlogStep]);

  const allMessagesForVersions = useMemo(
    () => [...(chatSession.state.messages ?? []), ...optimisticMessages],
    [chatSession.state.messages, optimisticMessages]
  );

  /** Step7 見出しNの最新コンテンツをチャットメッセージから取得（Canvas 未使用時の保存元） */
  const getLatestStep7HeadingContent = useCallback(
    (
      messages: ChatMessage[],
      headingIndex: number,
      /** 指定時はこの時刻以降のメッセージのみ対象（書き出し案送信後の誤判定防止） */
      minTimestamp?: number
    ): string | null => {
      const re = new RegExp(`^${getStep7HeadingModel(headingIndex)}(?:_|$)`);
      let latest: ChatMessage | null = null;
      let latestTs = 0;
      for (const m of messages) {
        if (m?.role !== 'assistant' || !m.model || !re.test(m.model)) continue;
        const ts = m.timestamp?.getTime() ?? 0;
        if (minTimestamp !== undefined && ts < minTimestamp) continue;
        if (ts >= latestTs) {
          latestTs = ts;
          latest = m;
        }
      }
      const content = latest?.content?.trim();
      return content ?? null;
    },
    []
  );

  const {
    isEditingTitle,
    draftTitle,
    titleError,
    isSavingTitle,
    handleTitleEditStart,
    handleTitleEditChange,
    handleTitleEditCancel,
    handleTitleEditConfirm,
  } = useSessionTitle({
    chatSession,
  });

  const { isGeneratingTitleMeta, handleGenerateTitleMeta } = useBlogTitleMetaGeneration({
    chatSession,
  });

  const {
    headingSections,
    isSavingHeading,
    isHeadingInitInFlight,
    hasAttemptedHeadingInit,
    headingSaveError,
    activeHeadingIndex,
    activeHeading,
    latestCombinedContent,
    combinedContentVersions,
    resetCombinedVersionToLatest,
    refetchCombinedContentVersions,
    handleRetryHeadingInit,
    runHeadingInitFromBasicStructure,
    refetchHeadings,
    handleSaveHeadingSection: handleSaveHeadingSectionFromFlow,
  } = useHeadingFlow({
    sessionId: chatSession.state.currentSessionId ?? null,
    isSessionLoading: chatSession.state.isLoading,
    resolvedCanvasStep,
  });

  const hasStep7Content =
    (chatSession.state.messages ?? []).some(
      m =>
        m?.role === 'assistant' &&
        (m.model === toBlogModel(STEP7_ID) || m.model?.startsWith(`${BLOG_MODEL_PREFIX}step7_`))
    ) || Boolean(latestCombinedContent?.trim());

  const {
    blogCanvasVersionsByStep,
    step7FromMessages,
    setSelectedVersionByStep,
    setFollowLatestByStep,
    canvasVersionsForStep,
    activeCanvasVersion,
    activeVersionId,
  } = useCanvasVersions(allMessagesForVersions, resolvedCanvasStep, {
    // 完成形あり時は常時 override を渡し、ステップ移動時も選択状態を保持
    // exactOptionalPropertyTypes のため undefined ではなくプロパティ自体を省略
    ...(combinedContentVersions.length > 0 && {
      step7VersionsOverride: combinedContentVersions,
    }),
  });

  const {
    annotationData,
    setAnnotationData,
    annotationLoading,
    setAnnotationLoading,
    handleLoadBlogArticle,
  } = useWordpressSync({
    currentSessionId: chatSession.state.currentSessionId,
    loadSession: chatSession.actions.loadSession,
    setFollowLatestByStep,
    setSelectedVersionByStep,
  });
  // StepActionBarのrefを定義
  const stepActionBarRef = useRef<StepActionBarRef>(null);

  const {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    handleResetHeadingConfiguration,
    totalHeadings,
    isHeadingFlowCanvasStep,
    effectiveViewingHeadingIndex,
    headingCanvasViewMode,
    isStep6ContentStale,
    setIsStep6ContentStale,
    hasContentForActiveHeading,
    minTsForContentCheck,
  } = useStep7HeadingView({
    chatSession,
    headingSections,
    refetchHeadings,
    refetchCombinedContentVersions,
    handleRetryHeadingInit,
    runHeadingInitFromBasicStructure,
    setCanvasStreamingContent,
    setCanvasPanelOpen,
    pendingViewingIndexRef,
    requestedCombinedViewRef,
    resolvedCanvasStep,
    activeHeadingIndex,
    isViewingPastHeadingContent,
    isViewingCombinedContent,
    step7FromMessages,
    blogCanvasVersionsByStep,
    getLatestStep7HeadingContent,
    allMessagesForVersions,
    canvasStreamingContent,
  });

  const {
    canvasContent,
    isHeadingUnitStep7View,
    canvasVersionsWithMeta,
    canvasStepOptions,
    combinedTiles,
  } = useCanvasPanelContent({
    fallbackMessageIdRef,
    canvasEditInFlightRef,
    pendingCombinedVersionIdRef,
    pendingCombinedContentRef,
    blogCanvasVersionsByStep,
    isCanvasStreaming,
    setCanvasStreamingContent,
    isHeadingFlowCanvasStep,
    isViewingPastHeadingContent,
    isViewingCombinedContent,
    canvasStreamingContent,
    activeCanvasVersion,
    activeVersionId,
    combinedContentVersions,
    latestCombinedContent,
    headingCanvasViewMode,
    headingSections,
    step6ToStep7Lead,
    isStep6ContentStale,
    viewingHeadingIndex,
    activeHeadingIndex,
    getLatestStep7HeadingContent,
    allMessagesForVersions,
    minTsForContentCheck,
    canvasVersionsForStep,
  });

  const {
    handleBeforeManualStepChange,
    handleManualStepChangeForCanvas,
    handleModelChange,
    handleNextStepChange,
    blogFlowActive,
    handleSendMessage,
    handleSaveStep7UserLead,
  } = useBlogFlowControls({
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
  });

  const {
    viewingSection,
    handleSaveHeadingClick,
    handleBuildCombinedOnly,
    handleStartHeadingGeneration,
  } = useStep7HeadingActions({
    chatSession,
    viewingHeadingIndex,
    headingSections,
    activeHeadingIndex,
    activeHeading,
    isStep6ContentStale,
    setIsStep6ContentStale,
    canvasPanelOpen,
    effectiveViewingHeadingIndex,
    canvasContentRef,
    canvasStreamingContent,
    canvasContent,
    getLatestStep7HeadingContent,
    allMessagesForVersions,
    hasContentForActiveHeading,
    handleSaveHeadingSectionFromFlow,
    setCanvasStreamingContent,
    saveHeadingInFlightRef,
    buildCombinedInFlightRef,
    setIsBuildingCombined,
    setSelectedModel,
    resetCombinedVersionToLatest,
    setSelectedVersionByStep,
    refetchCombinedContentVersions,
    openCombinedCanvasRef,
    pendingAutoOpenHeadingRef,
    handleSendMessage,
  });

  const { handleCanvasSelectionEdit } = useCanvasSelectionEditStream({
    canvasEditInFlightRef,
    setIsCanvasStreaming,
    resolvedCanvasStep,
    stepActionBarRef,
    latestBlogStep,
    headingSections,
    viewingHeadingIndex,
    activeHeadingIndex,
    isViewingPastHeadingContent,
    isViewingCombinedContent,
    chatSession,
    setCanvasStreamingContent,
    setOptimisticMessages,
    annotationOpen,
    setAnnotationOpen,
    setAnnotationData,
    setCanvasStep,
    setSelectedVersionByStep,
    setFollowLatestByStep,
    setCanvasPanelOpen,
    canvasEditHistory,
    setCanvasEditHistory,
    handleModelChange,
    refetchCombinedContentVersions,
  });

  const {
    handleShowCanvas,
    handleOpenCombinedCanvas,
    effectiveActiveVersionId,
    effectiveOnVersionSelect,
    handleCanvasStepSelect,
  } = useCanvasNavigation({
    chatSession,
    latestBlogStep,
    resolvedCanvasStep,
    blogCanvasVersionsByStep,
    headingSections,
    isHeadingFlowCanvasStep,
    isHeadingUnitStep7View,
    activeVersionId,
    combinedContentVersions,
    latestCombinedContent,
    annotationOpen,
    fallbackMessageIdRef,
    pendingViewingIndexRef,
    prevChatLoadingRef,
    pendingAutoOpenHeadingRef,
    requestedCombinedViewRef,
    pendingCombinedVersionIdRef,
    pendingCombinedContentRef,
    setCanvasStreamingContent,
    setCanvasStep,
    setIsViewingCombinedContent,
    setIsViewingPastHeadingContent,
    setViewingHeadingIndex,
    setSelectedVersionByStep,
    setFollowLatestByStep,
    setAnnotationOpen,
    setAnnotationData,
    setCanvasPanelOpen,
    setCanvasEditHistory,
  });
  openCombinedCanvasRef.current = handleOpenCombinedCanvas;

  // ✅ 保存ボタンクリック時にAnnotationPanelを表示する関数
  const handleOpenAnnotation = async () => {
    if (!chatSession.state.currentSessionId) return;

    setAnnotationLoading(true);
    try {
      // データベースから既存のアノテーションデータを取得
      const res = await getContentAnnotationBySession(chatSession.state.currentSessionId);
      if (!res.success) {
        if (isEmailLinkConflictResult(res)) {
          replaceToEmailLinkConflictLogin();
          return;
        }
        setAnnotationData(null);
      } else if (res.data) {
        setAnnotationData(res.data);
      } else {
        setAnnotationData(null);
      }

      // Canvasパネルが開いている場合は同時に切り替え
      if (canvasPanelOpen) {
        setCanvasPanelOpen(false);
      }

      // データ取得完了後にパネルを表示
      setAnnotationOpen(true);
    } catch (error) {
      console.error('Failed to load annotation data:', error);
      setAnnotationData(null);

      // エラーでも切り替えを実行
      if (canvasPanelOpen) {
        setCanvasPanelOpen(false);
      }
      setAnnotationOpen(true);
    } finally {
      setAnnotationLoading(false);
    }
  };
  // relative: InputArea の absolute ヘッダーの基準。高さは AppShell のモバイル上部バー
  // （h-14 = 3.5rem。lg 以上では無い）を引いたビューポート高。
  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)] lg:h-dvh" data-testid="chat-layout">
      <ChatLayoutContent
        ctx={{
          chatSession,
          isMobile,
          blogFlowActive,
          optimisticMessages,
          isCanvasStreaming,
          selectedModel,
          latestBlogStep,
          stepActionBarRef,
          ui: {
            sidebar: { open: sidebarOpen, setOpen: setSidebarOpen },
            canvas: { open: canvasPanelOpen, show: handleShowCanvas },
            annotation: {
              open: annotationOpen,
              loading: annotationLoading,
              data: annotationData,
              setOpen: setAnnotationOpen,
              openWith: handleOpenAnnotation,
              setData: setAnnotationData,
            },
          },
          onSendMessage: handleSendMessage,
          handleModelChange,
          nextStepForPlaceholder,
          currentSessionTitle,
          isEditingSessionTitle: isEditingTitle,
          draftSessionTitle: draftTitle,
          sessionTitleError: titleError,
          isSavingSessionTitle: isSavingTitle,
          onSessionTitleEditStart: handleTitleEditStart,
          onSessionTitleEditChange: handleTitleEditChange,
          onSessionTitleEditCancel: handleTitleEditCancel,
          onSessionTitleEditConfirm: handleTitleEditConfirm,
          onNextStepChange: handleNextStepChange,
          hasStep7Content,
          onGenerateTitleMeta: handleGenerateTitleMeta,
          isGenerateTitleMetaLoading: isGeneratingTitleMeta,
          onLoadBlogArticle: handleLoadBlogArticle,
          onBeforeManualStepChange: handleBeforeManualStepChange,
          onManualStepChange: handleManualStepChangeForCanvas,
          isHeadingInitInFlight,
          hasAttemptedHeadingInit,
          onRetryHeadingInit: handleRetryHeadingInit,
          isSavingHeading,
          headingSections,
          totalHeadings: headingSections.length,
          ...(viewingSection && { headingIndex: viewingHeadingIndex as number }),
          ...((() => {
            const t =
              activeHeadingIndex !== undefined
                ? headingSections[activeHeadingIndex]?.headingText
                : viewingSection?.headingText;
            return t ? { currentHeadingText: t } : {};
          })()),
          initialStep,
          services,
          selectedServiceId,
          onServiceChange: handleServiceChange,
          servicesError,
          onDismissServicesError: dismissServicesError,
          onResetHeadingConfiguration: handleResetHeadingConfiguration,
          resolvedCanvasStep,
          setCanvasStep,
          ...(activeHeadingIndex !== undefined && { activeHeadingIndex }),
          ...(isHeadingFlowCanvasStep && {
            isStep7SaveDisabled: isStep6ContentStale || !hasContentForActiveHeading,
          }),
          onStartHeadingGeneration: handleStartHeadingGeneration,
          onSaveHeadingSection: handleSaveHeadingClick,
          onBuildCombinedOnly: handleBuildCombinedOnly,
          isChatLoading: chatSession.state.isLoading,
          isBuildingCombined,
          onSaveStep7UserLead: handleSaveStep7UserLead,
          step6ToStep7LeadSaved,
          ...(combinedTiles.length > 0 && { combinedTiles }),
          onOpenCombinedCanvas: handleOpenCombinedCanvas,
          onContinueFromTruncation: () => {
            setCanvasStreamingContent('');
            const lastMsg = chatSession.state.messages[chatSession.state.messages.length - 1];
            if (lastMsg?.model) {
              void chatSession.actions.sendMessage('続けてください', lastMsg.model, { continuationMode: true });
            }
          },
        }}
      />
      {canvasPanelOpen && (
        <CanvasPanel
          onClose={() => {
            setCanvasPanelOpen(false);
          }}
          content={canvasContent}
          isVisible={canvasPanelOpen}
          onSelectionEdit={handleCanvasSelectionEdit}
          versions={canvasVersionsWithMeta}
          activeVersionId={effectiveActiveVersionId}
          {...(effectiveOnVersionSelect !== undefined && {
            onVersionSelect: effectiveOnVersionSelect,
          })}
          stepOptions={canvasStepOptions}
          activeStepId={resolvedCanvasStep ?? null}
          onStepSelect={handleCanvasStepSelect}
          streamingContent={canvasStreamingContent}
          canvasContentRef={canvasContentRef}
          showHeadingUnitActions={isHeadingFlowCanvasStep && totalHeadings > 0}
          {...(headingCanvasViewMode.headingIndex !== null && {
            headingIndex: headingCanvasViewMode.headingIndex,
          })}
          totalHeadings={headingSections.length}
          hideOutline={
            isHeadingFlowCanvasStep &&
            effectiveViewingHeadingIndex !== null &&
            totalHeadings > 0
          }
          hideHeadingProgressAndNav={isViewingPastHeadingContent}
          isSavingHeading={isSavingHeading}
          headingSaveError={headingSaveError}
          isStreaming={isCanvasStreaming}
        />
      )}
    </div>
  );
};
