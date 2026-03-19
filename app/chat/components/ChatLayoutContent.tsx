import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BLOG_STEP_IDS,
  FIRST_BLOG_STEP_ID,
  MIN_LEAD_CONTENT_LENGTH,
  STEP5_ID,
  STEP6_GET_PLACEHOLDER_KEY,
  STEP6_ID,
  STEP7_ID,
  STRUCTURE_PATTERN_CHECK_LENGTH,
  BlogStepId,
  toBlogModel,
} from '@/lib/constants';
import { BASIC_STRUCTURE_PATTERN } from '@/lib/canvas-content';
import SessionSidebar from './SessionSidebar';
import MessageArea from './MessageArea';
import InputArea from './InputArea';
import AnnotationPanel from './AnnotationPanel';
import { useLiffContext } from '@/components/LiffProvider';
import { ChatLayoutCtx } from '@/types/chat-layout';
import { DismissibleErrorAlert, DismissibleWarningAlert } from '@/components/DismissibleAlerts';
import { ViewModeBanner } from '@/components/ViewModeBanner';

export const ChatLayoutContent: React.FC<{ ctx: ChatLayoutCtx }> = ({ ctx }) => {
  const {
    chatSession,
    subscription,
    isMobile,
    blogFlowActive,
    optimisticMessages,
    latestStep7LeadTimestamp,
    isCanvasStreaming,
    selectedModel,
    latestBlogStep,
    stepActionBarRef,
    ui,
    onSendMessage,
    handleModelChange,
    currentSessionTitle,
    isEditingSessionTitle,
    draftSessionTitle,
    sessionTitleError,
    isSavingSessionTitle,
    onSessionTitleEditStart,
    onSessionTitleEditChange,
    onSessionTitleEditCancel,
    onSessionTitleEditConfirm,
    onNextStepChange,
    hasStep7Content,
    onGenerateTitleMeta,
    isGenerateTitleMetaLoading,
    onLoadBlogArticle,
    onBeforeManualStepChange,
    onManualStepChange: ctxOnManualStepChange,
    isHeadingInitInFlight,
    hasAttemptedHeadingInit,
    onRetryHeadingInit,
    isSavingHeading,
    headingIndex,
    totalHeadings,
    currentHeadingText,
    headingSections,
    initialStep,
    services,
    selectedServiceId,
    onServiceChange,
    servicesError,
    onDismissServicesError,
    activeHeadingIndex,
    isStep7SaveDisabled,
    onStartHeadingGeneration,
    onSaveHeadingSection,
    onBuildCombinedOnly,
    isChatLoading,
    isBuildingCombined,
    onSaveStep7UserLead,
    step6ToStep7LeadSaved,
    combinedTiles,
    onOpenCombinedCanvas,
  } = ctx;
  const { isOwnerViewMode } = useLiffContext();
  const [manualBlogStep, setManualBlogStep] = useState<BlogStepId | null>(null);

  const currentStep: BlogStepId = BLOG_STEP_IDS[0] as BlogStepId;
  const flowStatus = useMemo((): 'idle' | 'running' | 'waitingAction' | 'error' => {
    if (isChatLoading || isBuildingCombined) return 'running';
    return 'idle';
  }, [isChatLoading, isBuildingCombined]);
  const normalizedInitialStep =
    initialStep && BLOG_STEP_IDS.includes(initialStep) ? initialStep : null;
  // 最新メッセージのステップを優先し、なければ初期ステップにフォールバック
  const detectedStep = latestBlogStep ?? normalizedInitialStep ?? currentStep;
  // step6ToStep7LeadSaved 時は effect に依存せず同期的に step7 表示（書き出し案保存後の遷移遅延を防ぐ）
  const displayStep =
    manualBlogStep ??
    (step6ToStep7LeadSaved && detectedStep === STEP6_ID ? STEP7_ID : detectedStep);
  /** 最後の assistant（MIN_LEAD_CONTENT_LENGTH 文字以上）が 構成案（基本構成）の場合は true。step6→7 保存をスキップし通常送信にする */
  const lastAssistantIsBasicStructure = useMemo(() => {
    const msgs = [...(chatSession?.state?.messages ?? []), ...(optimisticMessages ?? [])];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.role !== 'assistant' || (m.content ?? '').trim().length < MIN_LEAD_CONTENT_LENGTH)
        continue;
      const head = (m.content ?? '').slice(0, STRUCTURE_PATTERN_CHECK_LENGTH);
      return BASIC_STRUCTURE_PATTERN.test(head);
    }
    return false;
  }, [chatSession?.state?.messages, optimisticMessages]);
  const hasDetectedBlogStep =
    latestBlogStep !== null ||
    (normalizedInitialStep !== null && normalizedInitialStep !== BLOG_STEP_IDS[0]);
  const displayIndex = useMemo(() => {
    const index = BLOG_STEP_IDS.indexOf(displayStep);
    return index >= 0 ? index : 0;
  }, [displayStep]);
  const shouldShowLoadButton = displayStep === STEP7_ID;
  /** StepActionBar「現在のステップ」用。ユーザーが取り組むステップ（displayStep）を表示し、next と整合させる。
   * 以前は content step（成果物の step）を表示していたが、displayStep=step2 のとき current=step1, next=step3 となり
   * 「ステップが飛んでいる」ように見えていた。displayStep に統一することで current=step2, next=step3 と連続して表示される。 */
  const stepForStepActionBar = displayStep;

  /**
   * ヒント・プレースホルダー・送信先モデルの単一ソース。
   * 論理の分散を避け、StepActionBar と InputArea で一貫した値を共有する。
   * 通常チャット入力は常に nextStepForSend のみ使用。Canvas のエビデンスチェック・自由記載は CanvasPanel 経由で分離。
   */
  const { nextStepForSend, stepForPlaceholder, placeholderKey } = useMemo(() => {
    // 手動でスキップ/バックしている場合は displayStep を反映（プレースホルダー更新のため）
    const useDisplayStep = manualBlogStep !== null || hasDetectedBlogStep;
    if (!useDisplayStep) {
      return {
        nextStepForSend: FIRST_BLOG_STEP_ID,
        stepForPlaceholder: FIRST_BLOG_STEP_ID,
        placeholderKey: toBlogModel(FIRST_BLOG_STEP_ID),
      };
    }
    const currentStep = displayStep ?? initialStep ?? FIRST_BLOG_STEP_ID;
    const currentIdx = BLOG_STEP_IDS.indexOf(currentStep);
    if (currentIdx === -1) {
      return {
        nextStepForSend: FIRST_BLOG_STEP_ID,
        stepForPlaceholder: FIRST_BLOG_STEP_ID,
        placeholderKey: toBlogModel(FIRST_BLOG_STEP_ID),
      };
    }
    // displayStep = 表示中コンテンツのステップ。nextStepForSend = この送信で得る出力のステップ。
    // step1 表示中（顕在/潜在）→ step2 で送信してペルソナ/デモグラ取得。
    // step6: 構成案表示中(lastAssistantIsBasicStructure)なら step6 で送信→書き出し案生成。
    // 書き出し案表示中なら step7 で送信→step7_lead に保存のみ（AI呼び出しなし）。
    // step7 は同ステップで送信。
    let nextStepForSend: BlogStepId;
    if (displayStep === STEP6_ID && !lastAssistantIsBasicStructure) {
      nextStepForSend = STEP7_ID; // 書き出し案入力→step7_lead に保存して見出し生成へ
    } else if (displayStep === STEP6_ID || displayStep === STEP7_ID) {
      nextStepForSend = (BLOG_STEP_IDS[currentIdx] ?? BLOG_STEP_IDS[0]) as BlogStepId;
    } else {
      const nextFromIdx = Math.min(currentIdx + 1, BLOG_STEP_IDS.length - 1);
      nextStepForSend = (BLOG_STEP_IDS[nextFromIdx] ?? BLOG_STEP_IDS[currentIdx]) as BlogStepId;
    }
    // プレースホルダー: この送信で得る出力＝nextStepForSend のラベル/プレースホルダー
    const placeholderKey =
      displayStep === STEP7_ID
        ? toBlogModel(STEP7_ID)
        : displayStep === STEP6_ID
          ? toBlogModel(STEP6_ID)
          : displayStep === STEP5_ID
            ? STEP6_GET_PLACEHOLDER_KEY
            : toBlogModel(nextStepForSend);
    const stepForPlaceholder =
      displayStep === STEP7_ID
        ? STEP7_ID
        : displayStep === STEP6_ID
          ? STEP6_ID
          : nextStepForSend;
    return { nextStepForSend, stepForPlaceholder, placeholderKey };
  }, [manualBlogStep, hasDetectedBlogStep, displayStep, initialStep, lastAssistantIsBasicStructure]);

  useEffect(() => {
    setManualBlogStep(null);
  }, [chatSession.state.currentSessionId]);

  useEffect(() => {
    if (!manualBlogStep) return;
    // step6ToStep7LeadSaved で step7 表示中にユーザーが Back で step6 を選んだ場合、
    // manualBlogStep === detectedStep になるが、クリアすると再び step7 表示に戻ってしまうためスキップ
    if (step6ToStep7LeadSaved && detectedStep === STEP6_ID) return;
    if (manualBlogStep === detectedStep) {
      setManualBlogStep(null);
    }
  }, [manualBlogStep, detectedStep, step6ToStep7LeadSaved]);

  // Step6→Step7 で書き出し案保存済みのとき、step7 表示に遷移（displayStep は上記の同期的な三項で既に step7 になる。manualBlogStep も揃える）
  useEffect(() => {
    if (step6ToStep7LeadSaved && detectedStep === STEP6_ID) {
      setManualBlogStep(STEP7_ID);
    }
  }, [step6ToStep7LeadSaved, detectedStep]);
  const handleManualStepChange = useCallback(
    (targetStep: BlogStepId) => {
      setManualBlogStep(targetStep);
      ctxOnManualStepChange?.(targetStep);
    },
    [ctxOnManualStepChange]
  );

  const [isErrorDismissed, setIsErrorDismissed] = useState(false);
  const [isWarningDismissed, setIsWarningDismissed] = useState(false);
  const [isSubscriptionErrorDismissed, setIsSubscriptionErrorDismissed] = useState(false);

  // エラーの表示制御
  useEffect(() => {
    setIsErrorDismissed(false);
  }, [chatSession.state.error]);

  useEffect(() => {
    setIsWarningDismissed(false);
  }, [chatSession.state.warning]);

  useEffect(() => {
    setIsSubscriptionErrorDismissed(false);
  }, [subscription.error]);

  // Step7 見出し生成フェーズではプレースホルダーと見出し生成ボタンの両方を表示するため必須
  const isStep7HeadingPhaseForBar =
    displayStep === STEP7_ID &&
    selectedModel === 'blog_creation' &&
    activeHeadingIndex !== undefined &&
    (totalHeadings ?? 0) > 0;
  const shouldShowStepActionBar =
    (blogFlowActive && !chatSession.state.isLoading) || isStep7HeadingPhaseForBar;

  const isReadOnly = isOwnerViewMode;

  const handleResetHeadingConfiguration = useCallback(
    async (options?: { preserveStep7Lead?: boolean }): Promise<boolean> => {
      return await ctx.onResetHeadingConfiguration(options);
    },
    [ctx]
  );

  return (
    <>
      {isReadOnly && <ViewModeBanner />}
      {/* デスクトップサイドバー */}
      {!isMobile && (
        <SessionSidebar
          sessions={chatSession.state.sessions}
          currentSessionId={chatSession.state.currentSessionId}
          actions={chatSession.actions}
          isLoading={chatSession.state.isLoading}
          isMobile={false}
          searchQuery={chatSession.state.searchQuery}
          searchResults={chatSession.state.searchResults}
          searchError={chatSession.state.searchError}
          isSearching={chatSession.state.isSearching}
          disableActions={isReadOnly}
        />
      )}

      {/* モバイルサイドバー（Sheet） */}
      {isMobile && (
        <Sheet open={ui.sidebar.open} onOpenChange={ui.sidebar.setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 left-2 z-10"
              aria-label="メニューを開く"
            >
              <Menu size={20} />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 max-w-[280px] sm:max-w-[280px]">
            <SessionSidebar
              sessions={chatSession.state.sessions}
              currentSessionId={chatSession.state.currentSessionId}
              actions={{
                ...chatSession.actions,
                loadSession: async (sessionId: string) => {
                  await chatSession.actions.loadSession(sessionId);
                  ui.sidebar.setOpen(false);
                },
                startNewSession: () => {
                  chatSession.actions.startNewSession();
                  ui.sidebar.setOpen(false);
                },
              }}
              isLoading={chatSession.state.isLoading}
              isMobile
              searchQuery={chatSession.state.searchQuery}
              searchResults={chatSession.state.searchResults}
              searchError={chatSession.state.searchError}
              isSearching={chatSession.state.isSearching}
              disableActions={isReadOnly}
            />
          </SheetContent>
        </Sheet>
      )}

      <div className={cn('flex-1 flex flex-col pt-16', isMobile && 'pt-16')}>
        {subscription.error &&
          !subscription.requiresSubscription &&
          !isSubscriptionErrorDismissed && (
            <DismissibleErrorAlert
              error={subscription.error}
              onClose={() => setIsSubscriptionErrorDismissed(true)}
            />
          )}

        {chatSession.state.error && !isErrorDismissed && (
          <DismissibleErrorAlert error={chatSession.state.error} onClose={() => setIsErrorDismissed(true)} />
        )}

        {chatSession.state.warning && !isWarningDismissed && (
          <DismissibleWarningAlert
            message={chatSession.state.warning}
            onClose={() => setIsWarningDismissed(true)}
          />
        )}

        {servicesError && <DismissibleWarningAlert message={servicesError} onClose={onDismissServicesError} />}

        <MessageArea
          messages={[...chatSession.state.messages, ...optimisticMessages]}
          latestStep7LeadTimestamp={latestStep7LeadTimestamp}
          isLoading={chatSession.state.isLoading || isCanvasStreaming}
          blogFlowActive={blogFlowActive}
          onOpenCanvas={message => ui.canvas.show(message)}
          headingSections={headingSections}
          {...(combinedTiles && combinedTiles.length > 0 && { combinedTiles })}
          {...(onOpenCombinedCanvas && { onOpenCombinedCanvas })}
        />

        <InputArea
          onSendMessage={onSendMessage}
          disabled={chatSession.state.isLoading || ui.annotation.loading || isReadOnly}
          shouldShowStepActionBar={shouldShowStepActionBar}
          stepActionBarRef={stepActionBarRef}
          displayStep={displayStep}
          stepForStepActionBar={stepForStepActionBar}
          hasDetectedBlogStep={hasDetectedBlogStep}
          onSaveClick={() => ui.annotation.openWith()}
          annotationLoading={ui.annotation.loading}
          isSavingHeading={isSavingHeading}
          hasStep7Content={hasStep7Content}
          onGenerateTitleMeta={onGenerateTitleMeta}
          isGenerateTitleMetaLoading={isGenerateTitleMetaLoading}
          stepActionBarDisabled={chatSession.state.isLoading || ui.annotation.loading}
          currentSessionTitle={currentSessionTitle}
          currentSessionId={chatSession.state.currentSessionId}
          isMobile={isMobile}
          onMenuToggle={isMobile ? () => ui.sidebar.setOpen(!ui.sidebar.open) : undefined}
          blogFlowActive={blogFlowActive}
          blogProgress={{ currentIndex: displayIndex, total: BLOG_STEP_IDS.length }}
          onModelChange={handleModelChange}
          blogFlowStatus={flowStatus}
          selectedModelExternal={selectedModel}
          nextStepForSend={nextStepForSend}
          stepForPlaceholder={stepForPlaceholder}
          placeholderKey={placeholderKey}
          onNextStepChange={onNextStepChange}
          onManualStepChange={handleManualStepChange}
          isEditingTitle={isEditingSessionTitle}
          draftSessionTitle={draftSessionTitle}
          sessionTitleError={sessionTitleError}
          onSessionTitleEditStart={onSessionTitleEditStart}
          onSessionTitleEditChange={onSessionTitleEditChange}
          onSessionTitleEditCancel={onSessionTitleEditCancel}
          onSessionTitleEditConfirm={onSessionTitleEditConfirm}
          isSavingSessionTitle={isSavingSessionTitle}
          searchQuery={chatSession.state.searchQuery}
          searchError={chatSession.state.searchError}
          isSearching={chatSession.state.isSearching}
          onSearch={query => {
            void chatSession.actions.searchSessions(query);
          }}
          onClearSearch={chatSession.actions.clearSearch}
          initialBlogStep={displayStep}
          onLoadBlogArticle={
            shouldShowStepActionBar && shouldShowLoadButton && onLoadBlogArticle
              ? onLoadBlogArticle
              : undefined
          }
          onBeforeManualStepChange={onBeforeManualStepChange}
          isHeadingInitInFlight={isHeadingInitInFlight}
          hasAttemptedHeadingInit={hasAttemptedHeadingInit}
          {...(onRetryHeadingInit !== undefined && { onRetryHeadingInit })}
          onResetHeadingConfiguration={handleResetHeadingConfiguration}
          totalHeadings={totalHeadings}
          {...(headingIndex !== undefined && { headingIndex })}
          {...(currentHeadingText !== undefined && { currentHeadingText })}
          {...(activeHeadingIndex !== undefined && { activeHeadingIndex })}
          isStep7SaveDisabled={isStep7SaveDisabled ?? true}
          {...(onStartHeadingGeneration && { onStartHeadingGeneration })}
          {...(onSaveHeadingSection && { onSaveHeadingSection })}
          {...(onBuildCombinedOnly && { onBuildCombinedOnly })}
          isChatLoading={isChatLoading ?? false}
          isBuildingCombined={isBuildingCombined ?? false}
          {...(onSaveStep7UserLead && { onSaveStep7UserLead })}
          onStep6ToStep7Success={() => setManualBlogStep(STEP7_ID)}
          lastAssistantIsBasicStructure={lastAssistantIsBasicStructure}
          services={services}
          selectedServiceId={selectedServiceId}
          onServiceChange={onServiceChange}
        />
      </div>

      {ui.annotation.open && (
        <AnnotationPanel
          sessionId={chatSession.state.currentSessionId || ''}
          initialData={ui.annotation.data}
          onClose={() => {
            ui.annotation.setOpen(false);
          }}
          onSaveSuccess={() => {
            if (
              displayStep === STEP7_ID &&
              totalHeadings === 0 &&
              typeof onRetryHeadingInit === 'function'
            ) {
              onRetryHeadingInit();
            }
          }}
          isVisible={ui.annotation.open}
        />
      )}
    </>
  );
};
