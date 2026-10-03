import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import type { ChatLayoutProps } from '@/types/chat-layout';
import type { BlogStepId } from '@/lib/constants';
import { BLOG_STEP_IDS, STEP7_ID, isStep7HeadingModel } from '@/lib/constants';
import {
  extractBlogStepFromModel,
  extractStep7HeadingIndexFromModel,
  isBlogStepId,
  normalizeCanvasContent,
} from '@/lib/canvas-content';
import type { SessionHeadingSection } from '@/types/heading-flow';
import type { AnnotationRecord } from '@/types/annotation';

interface UseCanvasNavigationParams {
  chatSession: ChatLayoutProps['chatSession'];
  latestBlogStep: BlogStepId | null;
  resolvedCanvasStep: BlogStepId | null;
  blogCanvasVersionsByStep: ReturnType<typeof useCanvasVersions>['blogCanvasVersionsByStep'];
  headingSections: SessionHeadingSection[];
  isHeadingFlowCanvasStep: boolean;
  isHeadingUnitStep7View: boolean;
  activeVersionId: ReturnType<typeof useCanvasVersions>['activeVersionId'];
  combinedContentVersions: ReturnType<typeof useHeadingFlow>['combinedContentVersions'];
  latestCombinedContent: string | null;
  annotationOpen: boolean;
  fallbackMessageIdRef: RefObject<string | null>;
  pendingViewingIndexRef: RefObject<number | null>;
  prevChatLoadingRef: RefObject<boolean>;
  pendingAutoOpenHeadingRef: RefObject<boolean>;
  requestedCombinedViewRef: RefObject<boolean>;
  pendingCombinedVersionIdRef: RefObject<string | null>;
  pendingCombinedContentRef: RefObject<string | null>;
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  setCanvasStep: Dispatch<SetStateAction<BlogStepId | null>>;
  setIsViewingCombinedContent: Dispatch<SetStateAction<boolean>>;
  setIsViewingPastHeadingContent: Dispatch<SetStateAction<boolean>>;
  setViewingHeadingIndex: Dispatch<SetStateAction<number | null>>;
  setSelectedVersionByStep: ReturnType<typeof useCanvasVersions>['setSelectedVersionByStep'];
  setFollowLatestByStep: ReturnType<typeof useCanvasVersions>['setFollowLatestByStep'];
  setAnnotationOpen: Dispatch<SetStateAction<boolean>>;
  setAnnotationData: Dispatch<SetStateAction<AnnotationRecord | null>>;
  setCanvasPanelOpen: Dispatch<SetStateAction<boolean>>;
  setCanvasEditHistory: Dispatch<SetStateAction<{ role: 'user' | 'assistant'; content: string }[]>>;
}

export function useCanvasNavigation({
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
}: UseCanvasNavigationParams) {
  // ✅ Canvasボタンクリック時にCanvasPanelを表示する関数
  const handleShowCanvas = useCallback(
    (message: ChatMessage) => {
      const fallbackStep = (latestBlogStep ?? BLOG_STEP_IDS[0]) as BlogStepId;
      const detectedStep = extractBlogStepFromModel(message.model) ?? fallbackStep;

      const versions = blogCanvasVersionsByStep[detectedStep] ?? [];
      const latestVersionId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;
      const hasExactMatch = versions.some(version => version.id === message.id);
      const targetVersionId = hasExactMatch ? message.id : latestVersionId;

      // タイルクリック時: クリックした message の content をそのまま表示する。
      // バージョン管理に依存せず、step1〜7・見出し単体を問わず確実に該当コンテンツを開く。
      const normalizedFromMessage = normalizeCanvasContent(message.content ?? '');
      fallbackMessageIdRef.current = null;
      setCanvasStreamingContent(normalizedFromMessage || '');

      setCanvasStep(detectedStep);
      setIsViewingCombinedContent(false);
      setSelectedVersionByStep(prev => {
        const next = { ...prev };
        next[detectedStep] = targetVersionId ?? null;
        return next;
      });
      setFollowLatestByStep(prev => {
        const next = { ...prev };
        next[detectedStep] = targetVersionId !== null && targetVersionId === latestVersionId;
        return next;
      });

      // Step7 タイルクリック時は該当見出しのインデックスを設定
      if (detectedStep === STEP7_ID && headingSections.length > 0) {
        let targetIdx = extractStep7HeadingIndexFromModel(message.model);

        if (targetIdx !== null && (targetIdx < 0 || targetIdx >= headingSections.length)) {
          targetIdx = null;
        }

        // model に _hN がない旧メッセージはバージョン管理のみ。本文フォールバックは行わない。
        if (targetIdx !== null) {
          // step7 未表示時にタイルクリック: effect が上書きするため pending を使用。step7 表示中は setViewingHeadingIndex のみ（effect は deps 変化で動かないため）
          if (!isHeadingFlowCanvasStep) {
            pendingViewingIndexRef.current = targetIdx;
          }
          setViewingHeadingIndex(targetIdx);
          setIsViewingPastHeadingContent(false);
        } else {
          // targetIdx が解決できない場合は、見出し行の有無に関わらず過去／未マッピング扱いにする。
          // 旧フォーマット（### なし）メッセージでも保存を有効にすると誤上書きの原因になるため。
          pendingViewingIndexRef.current = null;
          setViewingHeadingIndex(null);
          setIsViewingPastHeadingContent(true);
        }
      } else {
        setIsViewingPastHeadingContent(false);
      }

      if (annotationOpen) {
        setAnnotationOpen(false);
        setAnnotationData(null);
      }
      setCanvasPanelOpen(true);
    },
    [
      annotationOpen,
      blogCanvasVersionsByStep,
      headingSections,
      isHeadingFlowCanvasStep,
      latestBlogStep,
      setCanvasStreamingContent,
      setViewingHeadingIndex,
      setAnnotationData,
      setFollowLatestByStep,
      setSelectedVersionByStep,
      fallbackMessageIdRef,
      pendingViewingIndexRef,
      setIsViewingCombinedContent,
      setIsViewingPastHeadingContent,
      setCanvasStep,
      setCanvasPanelOpen,
      setAnnotationOpen,
    ]
  );

  // ✅ 見出し生成ストリーミング完了時にCanvasを自動オープン
  useEffect(() => {
    const wasLoading = prevChatLoadingRef.current;
    const nowLoading = chatSession.state.isLoading ?? false;
    prevChatLoadingRef.current = nowLoading;

    if (wasLoading && !nowLoading && pendingAutoOpenHeadingRef.current) {
      pendingAutoOpenHeadingRef.current = false;
      const messages = chatSession.state.messages ?? [];
      const last = messages[messages.length - 1];
      if (
        last?.role === 'assistant' &&
        last?.model &&
        isStep7HeadingModel(last.model)
      ) {
        handleShowCanvas(last);
      }
    }
  }, [
    chatSession.state.isLoading,
    chatSession.state.messages,
    handleShowCanvas,
    pendingAutoOpenHeadingRef,
    prevChatLoadingRef,
  ]);

  /** Step7 完成形タイルクリック時: Canvas で完成形を開く。他ステップと同様 selectedVersionByStep で選択 */
  const handleOpenCombinedCanvas = useCallback(
    (versionId?: string) => {
      requestedCombinedViewRef.current = true;
      pendingCombinedVersionIdRef.current = versionId ?? null;
      // 恒久対応: クリック時点で即時コンテンツを解決し、state 更新遅延による Canvas 空表示を防止
      const resolvedContent =
        versionId != null
          ? combinedContentVersions.find(v => v.id === versionId)?.content ?? null
          : latestCombinedContent;
      if (resolvedContent != null && resolvedContent.trim()) {
        pendingCombinedContentRef.current = resolvedContent;
      } else {
        pendingCombinedContentRef.current = null;
      }
      setViewingHeadingIndex(null);
      pendingViewingIndexRef.current = null;
      setIsViewingPastHeadingContent(false);
      setIsViewingCombinedContent(true);
      setCanvasStep(STEP7_ID);
      setCanvasStreamingContent('');
      setSelectedVersionByStep(prev => ({
        ...prev,
        [STEP7_ID]: versionId ?? null,
      }));
      // 特定バージョン選択時は追従を無効化し、effect による選択上書きを防止
      if (versionId) {
        setFollowLatestByStep(prev => ({
          ...prev,
          [STEP7_ID]: false,
        }));
      }
      if (annotationOpen) {
        setAnnotationOpen(false);
        setAnnotationData(null);
      }
      setCanvasPanelOpen(true);
    },
    [
      annotationOpen,
      combinedContentVersions,
      latestCombinedContent,
      setViewingHeadingIndex,
      setIsViewingPastHeadingContent,
      setCanvasStreamingContent,
      setAnnotationData,
      setSelectedVersionByStep,
      setFollowLatestByStep,
      setIsViewingCombinedContent,
      setCanvasStep,
      pendingCombinedVersionIdRef,
      pendingCombinedContentRef,
      pendingViewingIndexRef,
      requestedCombinedViewRef,
      setAnnotationOpen,
      setCanvasPanelOpen,
    ]
  );

  const handleCanvasVersionSelect = useCallback(
    (versionId: string) => {
      const step = resolvedCanvasStep;
      if (!step) return;
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;

      setCanvasStreamingContent('');
      setCanvasEditHistory([]);
      setSelectedVersionByStep(prev => {
        const next = { ...prev };
        next[step] = versionId;
        return next;
      });
      setFollowLatestByStep(prev => {
        const next = { ...prev };
        next[step] = latestId !== null && versionId === latestId;
        return next;
      });
    },
    [
      blogCanvasVersionsByStep,
      resolvedCanvasStep,
      setCanvasEditHistory,
      setCanvasStreamingContent,
      setFollowLatestByStep,
      setSelectedVersionByStep,
    ]
  );
  // 他ステップと同様: activeVersionId をそのまま使用。見出し単体のみバージョン選択無効
  const effectiveActiveVersionId = isHeadingUnitStep7View ? null : activeVersionId;
  const effectiveOnVersionSelect = isHeadingUnitStep7View ? undefined : handleCanvasVersionSelect;

  const handleCanvasStepChange = useCallback(
    (step: BlogStepId) => {
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;

      setIsViewingPastHeadingContent(false);
      setIsViewingCombinedContent(step === STEP7_ID && combinedContentVersions.length > 0);
      setCanvasStreamingContent('');
      setCanvasEditHistory([]);
      if (step === STEP7_ID && combinedContentVersions.length > 0) {
        requestedCombinedViewRef.current = true;
        setViewingHeadingIndex(null);
        // ステップ選択時も即時コンテンツ解決で空表示を防止（タイルクリックと同様）
        const resolvedContent =
          latestId != null
            ? combinedContentVersions.find(v => v.id === latestId)?.content ?? null
            : latestCombinedContent;
        if (resolvedContent != null && resolvedContent.trim()) {
          pendingCombinedContentRef.current = resolvedContent;
        } else {
          pendingCombinedContentRef.current = null;
        }
      }
      setCanvasStep(step);
      setSelectedVersionByStep(prev => {
        const next = { ...prev };
        const current = next[step];
        const exists = current ? versions.some(version => version.id === current) : false;
        if (!exists) {
          next[step] = latestId ?? null;
        }
        return next;
      });
      setFollowLatestByStep(prev => {
        const next = { ...prev };
        if (latestId && (next[step] === undefined || next[step])) {
          next[step] = true;
        } else if (next[step] === undefined) {
          next[step] = false;
        }
        return next;
      });
    },
    [
      blogCanvasVersionsByStep,
      combinedContentVersions,
      latestCombinedContent,
      setCanvasEditHistory,
      setCanvasStreamingContent,
      setFollowLatestByStep,
      setSelectedVersionByStep,
      setViewingHeadingIndex,
      setCanvasStep,
      setIsViewingCombinedContent,
      setIsViewingPastHeadingContent,
      requestedCombinedViewRef,
      pendingCombinedContentRef,
    ]
  );

  const handleCanvasStepSelect = useCallback(
    (stepId: string) => {
      if (!isBlogStepId(stepId)) return;
      handleCanvasStepChange(stepId);
    },
    [handleCanvasStepChange]
  );

  return {
    handleShowCanvas,
    handleOpenCombinedCanvas,
    effectiveActiveVersionId,
    effectiveOnVersionSelect,
    handleCanvasStepSelect,
  };
}
