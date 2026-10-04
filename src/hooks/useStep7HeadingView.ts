import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useHeadingCanvasState } from '@/hooks/useHeadingCanvasState';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import type { ChatLayoutProps } from '@/types/chat-layout';
import type { SessionHeadingSection } from '@/types/heading-flow';
import type { BlogStepId } from '@/lib/constants';
import { STEP7_ID } from '@/lib/constants';
import { resolveHeadingCanvasViewMode } from '@/lib/canvas-mode';

interface UseStep7HeadingViewParams {
  chatSession: ChatLayoutProps['chatSession'];
  headingSections: SessionHeadingSection[];
  refetchHeadings: ReturnType<typeof useHeadingFlow>['refetchHeadings'];
  refetchCombinedContentVersions: ReturnType<typeof useHeadingFlow>['refetchCombinedContentVersions'];
  handleRetryHeadingInit: ReturnType<typeof useHeadingFlow>['handleRetryHeadingInit'];
  runHeadingInitFromBasicStructure: ReturnType<typeof useHeadingFlow>['runHeadingInitFromBasicStructure'];
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  setCanvasPanelOpen: Dispatch<SetStateAction<boolean>>;
  pendingViewingIndexRef: RefObject<number | null>;
  requestedCombinedViewRef: RefObject<boolean>;
  resolvedCanvasStep: BlogStepId | null;
  activeHeadingIndex: number | undefined;
  isViewingPastHeadingContent: boolean;
  isViewingCombinedContent: boolean;
  step7FromMessages: ReturnType<typeof useCanvasVersions>['step7FromMessages'];
  blogCanvasVersionsByStep: ReturnType<typeof useCanvasVersions>['blogCanvasVersionsByStep'];
  getLatestStep7HeadingContent: (
    messages: ChatMessage[],
    headingIndex: number,
    minTimestamp?: number
  ) => string | null;
  allMessagesForVersions: ChatMessage[];
  canvasStreamingContent: string;
}

export function useStep7HeadingView({
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
}: UseStep7HeadingViewParams) {
  const {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    handleResetHeadingConfiguration,
  } = useHeadingCanvasState({
    sessionId: chatSession.state.currentSessionId || '',
    initialSections: headingSections as SessionHeadingSection[],
    onHeadingSaved: async () => {
      // 保存後、最新の状態（確定済みフラグや進捗）を同期するためにセッションをロード
      if (chatSession.state.currentSessionId) {
        // 1. まず見出しの確定状態を最新化し、取得したてのデータをキャプチャする
        const freshSections = await refetchHeadings();
        // 2. 次にセッション全体を同期
        await chatSession.actions.loadSession(chatSession.state.currentSessionId);
        // 3. 全見出し確定時: 完成形はユーザー入力の書き出しが必要のため自動再生成しない
        // 4. 途中状態では既存の完成形バージョン同期のみ行う
        (refetchCombinedContentVersions as (sections: SessionHeadingSection[]) => void)(
          freshSections as unknown as SessionHeadingSection[]
        );
      }
    },
    onResetComplete: async () => {
      const sid = chatSession.state.currentSessionId;
      if (sid) {
        // ストリーミング中コンテンツをクリア（リセット後の旧表示防止）
        setCanvasStreamingContent('');
        // 古い見出しをクリア
        await Promise.all([
          chatSession.actions.loadSession(sid),
          refetchHeadings(),
        ]);
        handleRetryHeadingInit({ fromReset: true });
        // 恒久対応: effect に依存せず basic_structure から見出しを再抽出して確実に見出し生成フェーズへ遷移
        await runHeadingInitFromBasicStructure(sid);
        setCanvasPanelOpen(true);
        pendingViewingIndexRef.current = 0;
      }
    },
  });

  // 表示中の見出しインデックス（0..n-1）。null = 全確定時の結合表示 は useHeadingCanvasState が管理
  const totalHeadings = headingSections.length;
  const isHeadingFlowCanvasStep = resolvedCanvasStep === STEP7_ID;
  // Step7 キャンバスの表示状態を計算。
  // タイルクリック直後は pendingViewingIndexRef を優先（effect 適用前の render で正しい進捗を表示）。
  const effectiveViewingHeadingIndex =
    pendingViewingIndexRef.current !== null
      ? pendingViewingIndexRef.current
      : viewingHeadingIndex;
  const headingCanvasViewMode = resolveHeadingCanvasViewMode({
    step: resolvedCanvasStep,
    headingCount: totalHeadings,
    viewingHeadingIndex: effectiveViewingHeadingIndex,
    activeHeadingIndex,
    ignoreActiveHeadingIndex: isViewingPastHeadingContent || isViewingCombinedContent,
  });

  const maxViewableIndex =
    activeHeadingIndex !== undefined ? activeHeadingIndex : Math.max(0, totalHeadings - 1);
  useEffect(() => {
    if (!isHeadingFlowCanvasStep) {
      pendingViewingIndexRef.current = null;
      requestedCombinedViewRef.current = false;
      setViewingHeadingIndex(null);
      return;
    }
    if (totalHeadings === 0) {
      setViewingHeadingIndex(null);
      return;
      // pending は消さない（onResetComplete で 0 を予約し、再抽出後に見出し1を開く意図がある）
    }
    const activeIdx = activeHeadingIndex ?? totalHeadings;
    // 見出しタイルクリックを優先（完成形フラグより先に消費し、残留による意図しない null 復帰を防止）
    const pending = pendingViewingIndexRef.current;
    if (pending !== null) {
      pendingViewingIndexRef.current = null;
      requestedCombinedViewRef.current = false;
      setViewingHeadingIndex(Math.min(Math.max(pending, 0), Math.max(0, totalHeadings - 1)));
      return;
    }
    // 完成形表示を明示的に要求した場合、viewingHeadingIndex を null に維持（effect のデフォルト上書きを防止）
    if (requestedCombinedViewRef.current) {
      requestedCombinedViewRef.current = false;
      setViewingHeadingIndex(null);
      return;
    }
    setViewingHeadingIndex(prev => {
      if (activeIdx >= totalHeadings) {
        if (prev === null) return null;
        return Math.min(Math.max(prev, 0), Math.max(0, totalHeadings - 1));
      }
      if (prev === null) return activeIdx;
      return Math.min(Math.max(prev, 0), maxViewableIndex);
    });
  }, [
    isHeadingFlowCanvasStep,
    totalHeadings,
    activeHeadingIndex,
    maxViewableIndex,
    setViewingHeadingIndex,
    pendingViewingIndexRef,
    requestedCombinedViewRef,
  ]);

  // 見出し保存後に activeHeadingIndex が進んでも Canvas は前見出しの本文のまま。
  // この状態で再保存すると誤保存になるため、新規生成が入るまで内容を空表示・保存無効化する。
  // （タイルクリックのロックで切り替え自体は防止しているが、エッジケースの防御として維持）
  const [isStep6ContentStale, setIsStep6ContentStale] = useState(false);
  const prevStep6SessionIdRef = useRef<string | null>(null);
  // 見出し編集中は完成形で汚染しない（step7FromMessages = メッセージ由来のみ）
  const versionsForHeadingStep =
    headingCanvasViewMode.isHeadingUnit
      ? step7FromMessages
      : (blogCanvasVersionsByStep[STEP7_ID] ?? []);
  const latestStep6Version = versionsForHeadingStep[versionsForHeadingStep.length - 1] ?? null;
  // 表示中見出し向けコンテンツがあるか。確定見出しは常にあり、アクティブ（未確定）はバージョン/ストリーミング/チャットメッセージで判定
  const sectionsMinUpdatedMs =
    headingSections.length > 0
      ? Math.min(
          ...headingSections.map(s =>
            s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity
          )
        )
      : Infinity;
  const minTsForContentCheck =
    sectionsMinUpdatedMs !== Infinity ? sectionsMinUpdatedMs : undefined;

  const hasContentForViewingHeading = useMemo(() => {
    const idx = viewingHeadingIndex;
    if (idx === null) {
      return headingSections.length > 0 && headingSections.every(s => s.isConfirmed);
    }
    if (idx < 0 || idx >= headingSections.length) return false;
    const section = headingSections[idx];
    if (section?.isConfirmed) return true;
    const headingIdx = idx;
    // チャットメッセージに blog_creation_step7_h{N} の応答があり、書き出し案送信後のものなら保存可能
    const fromChat = getLatestStep7HeadingContent(
      allMessagesForVersions,
      headingIdx,
      minTsForContentCheck
    );
    if (fromChat && fromChat.length > 0) return true;
    if (headingIdx === 0) {
      const fromStreaming = (canvasStreamingContent?.trim().length ?? 0) > 0;
      if (fromStreaming) return true;
      const allSectionsEmpty = headingSections.every(s => !s.content || s.content.trim() === '');
      const fromVersion = (latestStep6Version?.content?.trim().length ?? 0) > 0;
      if (allSectionsEmpty && fromVersion) {
        const versionCreatedMs = latestStep6Version?.createdAtIso
          ? new Date(latestStep6Version.createdAtIso).getTime()
          : (latestStep6Version?.createdAt ?? 0);
        const sectionsCreatedMs = Math.min(
          ...headingSections.map(s => (s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity))
        );
        if (sectionsCreatedMs !== Infinity && versionCreatedMs < sectionsCreatedMs) {
          return false;
        }
        return true;
      }
      if (allSectionsEmpty) return false;
      return fromVersion;
    }
    const prevHeading = headingSections[headingIdx - 1];
    if (!prevHeading?.isConfirmed) return false;
    const prevUpdatedMs = prevHeading.updatedAt ? new Date(prevHeading.updatedAt).getTime() : 0;
    const versionCreatedMs = latestStep6Version?.createdAtIso
      ? new Date(latestStep6Version.createdAtIso).getTime()
      : (latestStep6Version?.createdAt ?? 0);
    return versionCreatedMs > prevUpdatedMs;
  }, [
    viewingHeadingIndex,
    headingSections,
    latestStep6Version,
    canvasStreamingContent,
    allMessagesForVersions,
    getLatestStep7HeadingContent,
    minTsForContentCheck,
  ]);

  // StepActionBar 保存ボタンの可否: 保存対象は active 見出しなので、その content があるかで判定
  const hasContentForActiveHeading = useMemo(() => {
    if (activeHeadingIndex === undefined) {
      return headingSections.length > 0 && headingSections.every(s => s.isConfirmed);
    }
    if (activeHeadingIndex < 0 || activeHeadingIndex >= headingSections.length) return false;
    const section = headingSections[activeHeadingIndex];
    if (section?.isConfirmed) return true;
    const fromChat = getLatestStep7HeadingContent(
      allMessagesForVersions,
      activeHeadingIndex,
      minTsForContentCheck
    );
    if (fromChat && fromChat.length > 0) return true;
    if (activeHeadingIndex === 0) {
      const fromStreaming = (canvasStreamingContent?.trim().length ?? 0) > 0;
      if (fromStreaming) return true;
      const allSectionsEmpty = headingSections.every(s => !s.content || s.content.trim() === '');
      const fromVersion = (latestStep6Version?.content?.trim().length ?? 0) > 0;
      if (allSectionsEmpty && fromVersion) {
        const versionCreatedMs = latestStep6Version?.createdAtIso
          ? new Date(latestStep6Version.createdAtIso).getTime()
          : (latestStep6Version?.createdAt ?? 0);
        const sectionsCreatedMs = Math.min(
          ...headingSections.map(s => (s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity))
        );
        if (sectionsCreatedMs !== Infinity && versionCreatedMs < sectionsCreatedMs) {
          return false;
        }
        return true;
      }
      if (allSectionsEmpty) return false;
      return fromVersion;
    }
    const prevHeading = headingSections[activeHeadingIndex - 1];
    if (!prevHeading?.isConfirmed) return false;
    const prevUpdatedMs = prevHeading.updatedAt ? new Date(prevHeading.updatedAt).getTime() : 0;
    const versionCreatedMs = latestStep6Version?.createdAtIso
      ? new Date(latestStep6Version.createdAtIso).getTime()
      : (latestStep6Version?.createdAt ?? 0);
    return versionCreatedMs > prevUpdatedMs;
  }, [
    activeHeadingIndex,
    headingSections,
    latestStep6Version,
    canvasStreamingContent,
    allMessagesForVersions,
    getLatestStep7HeadingContent,
    minTsForContentCheck,
  ]);

  const hasContentForCurrentHeading =
    activeHeadingIndex !== undefined ? hasContentForActiveHeading : hasContentForViewingHeading;

  // ステール判定を単一の effect に統合
  useEffect(() => {
    const currentSessionId = chatSession.state.currentSessionId ?? null;

    if (!isHeadingFlowCanvasStep) {
      setIsStep6ContentStale(false);
      prevStep6SessionIdRef.current = currentSessionId;
      return;
    }

    // セッション切り替え時: ref をリセット
    if (prevStep6SessionIdRef.current !== currentSessionId) {
      prevStep6SessionIdRef.current = currentSessionId;
    }

    // ストリーミング中は常に非ステール
    if (canvasStreamingContent) {
      setIsStep6ContentStale(false);
      return;
    }

    // 現在見出し向けコンテンツがあれば非ステール
    if (hasContentForCurrentHeading) {
      setIsStep6ContentStale(false);
      return;
    }

    // hasContentForCurrentHeading の場合は上で return 済みのため、ここでは常にステール
    setIsStep6ContentStale(true);
  }, [
    chatSession.state.currentSessionId,
    isHeadingFlowCanvasStep,
    activeHeadingIndex,
    hasContentForCurrentHeading,
    canvasStreamingContent,
  ]);
  return {
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
  };
}
