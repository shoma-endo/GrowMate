'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useServiceSelection } from '@/hooks/useServiceSelection';
import { useLiffContext } from '@/components/LiffProvider';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import {
  extractStep7HeadingIndexFromModel,
  findLatestAssistantBlogStep,
  getContentStepFromAssistantModel,
  normalizeCanvasContent,
  isBlogStepId,
} from '@/lib/canvas-content';
import CanvasPanel from './CanvasPanel';
import type { CanvasSelectionEditPayload, CanvasSelectionEditResult } from '@/types/canvas';
import type { StepActionBarRef } from './StepActionBar';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import {
  getCombinedContentForStep7,
  saveStep7UserLead,
} from '@/server/actions/heading-flow.actions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import { useHeadingCanvasState } from '@/hooks/useHeadingCanvasState';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { stripLeadingHeadingLine } from '@/lib/heading-extractor';
import {
  BlogStepId,
  BLOG_MODEL_PREFIX,
  BLOG_STEP_IDS,
  FIRST_BLOG_STEP_ID,
  HEADING_FLOW_STEP_ID,
  STEP6_ID,
  STEP6_MODEL_REGEX,
  STEP7_LEAD_MODEL,
  getStep7HeadingModel,
  isStep7HeadingModel,
  toBlogModel,
} from '@/lib/constants';
import { ChatLayoutContent } from './ChatLayoutContent';
import { ChatLayoutProps } from '@/types/chat-layout';
import { createFullMarkdownDecoder } from '@/lib/markdown-decoder';
import { resolveHeadingCanvasViewMode } from '@/lib/canvas-mode';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useWordpressSync } from '@/hooks/useWordpressSync';
import { useSessionTitle } from '@/hooks/useSessionTitle';
import { toast } from 'sonner';

/** Step7 完成形タイル: コンテンツからタイトルと抜粋を抽出 */
const deriveTileFromContent = (content: string) => {
  const c = content?.trim() ?? '';
  if (!c) return { title: '完成形', excerpt: 'クリックしてCanvasで確認' };
  const rawLines = c.split('\n');
  const headingIdx = rawLines.findIndex(line => /^#+\s*/.test(line.trim()));
  const firstIdx = rawLines.findIndex(line => line.trim().length > 0);
  const titleLine = (headingIdx >= 0 ? rawLines[headingIdx] : rawLines[firstIdx]) ?? rawLines[0] ?? '';
  const title = titleLine.trim().replace(/^#+\s*/, '').trim() || '完成形';
  const bodyLines = rawLines.filter((_, i) => i !== headingIdx);
  const body = bodyLines.join('\n').trim();
  const excerptPlain = (body || c)
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^[0-9]+\.\s+/, ''))
    .filter(Boolean)
    .join(' ');
  const excerpt = excerptPlain.length > 140 ? `${excerptPlain.slice(0, 140)}…` : excerptPlain || 'クリックしてCanvasで確認';
  return { title, excerpt };
};

export const ChatLayout: React.FC<ChatLayoutProps> = ({
  chatSession,
  subscription,
  isMobile = false,
  initialStep = null,
}) => {
  const { getAccessToken, isOwnerViewMode } = useLiffContext();

  // サービス選択ロジックをカスタムフックで管理
  const serviceSelection = useServiceSelection({
    getAccessToken,
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

  /** Step6→Step7 で書き出し案を保存済みか＋その本文（chat_messages から復元）
   * saved: step7_lead が存在し、かつ最新の書き出し案(step6)より後に保存されている場合のみ true。
   * バックで step5 に戻り書き出し案を再生成した場合、新しい書き出し案が step7_lead より後になるため
   * saved=false となり「6. 書き出し案」を正しく表示できる。 */
  const step6ToStep7Lead = useMemo(() => {
    const msgs = [...(chatSession.state.messages ?? []), ...optimisticMessages];
    let latestLead: { content: string; ts: number } | null = null;
    let latestStep6Ts = 0;
    for (const m of msgs) {
      const ts = m?.timestamp?.getTime() ?? 0;
      if (m?.role === 'user' && m.model === STEP7_LEAD_MODEL) {
        const c = (m.content ?? '').trim();
        if (c && (!latestLead || ts >= latestLead.ts)) latestLead = { content: c, ts };
      } else if (m?.role === 'assistant' && m.model && STEP6_MODEL_REGEX.test(m.model)) {
        const len = (m.content ?? '').trim().length;
        if (len >= 20 && ts >= latestStep6Ts) latestStep6Ts = ts;
      }
    }
    const saved =
      latestLead !== null &&
      (latestStep6Ts === 0 || latestLead.ts >= latestStep6Ts);
    return { saved, content: latestLead?.content ?? null };
  }, [chatSession.state.messages, optimisticMessages]);

  const step6ToStep7LeadSaved = step6ToStep7Lead.saved;

  const resolvedCanvasStep = useMemo<BlogStepId | null>(() => {
    if (canvasStep) return canvasStep;
    // step6ToStep7LeadSaved は latestBlogStep が step6 のときのみ step7 にブリッジ
    if (
      step6ToStep7LeadSaved &&
      (latestBlogStep === STEP6_ID || latestBlogStep === null)
    ) {
      return HEADING_FLOW_STEP_ID;
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
    isGeneratingTitleMeta,
    handleTitleEditStart,
    handleTitleEditChange,
    handleTitleEditCancel,
    handleTitleEditConfirm,
    handleGenerateTitleMeta,
  } = useSessionTitle({
    chatSession,
    getAccessToken,
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
    getAccessToken,
    resolvedCanvasStep,
  });

  const hasStep7Content =
    (chatSession.state.messages ?? []).some(
      m =>
        m?.role === 'assistant' &&
        (m.model === toBlogModel(HEADING_FLOW_STEP_ID) || m.model?.startsWith(`${BLOG_MODEL_PREFIX}step7_`))
    ) || Boolean(latestCombinedContent?.trim());

  const {
    viewingHeadingIndex,
    setViewingHeadingIndex,
    handleResetHeadingConfiguration,
  } = useHeadingCanvasState({
    sessionId: chatSession.state.currentSessionId || '',
    getAccessToken,
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
  const isHeadingFlowCanvasStep = resolvedCanvasStep === HEADING_FLOW_STEP_ID;
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
  });

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
    getAccessToken,
    loadSession: chatSession.actions.loadSession,
    setFollowLatestByStep,
    setSelectedVersionByStep,
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
      : (blogCanvasVersionsByStep[HEADING_FLOW_STEP_ID] ?? []);
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

  // フォールバック表示の自動解除: canvasVersions に待機中 message.id が現れたら streamingContent をクリア
  useEffect(() => {
    const pendingId = fallbackMessageIdRef.current;
    if (!pendingId) return;

    const isResolved = Object.values(blogCanvasVersionsByStep).some(versions =>
      versions.some(v => v.id === pendingId)
    );
    if (isResolved) {
      fallbackMessageIdRef.current = null;
      // AI キャンバス編集が進行中の場合は streamingContent を上書きしない
      if (!isCanvasStreaming && !canvasEditInFlightRef.current) {
        setCanvasStreamingContent('');
      }
    }
  }, [blogCanvasVersionsByStep, isCanvasStreaming]);

  const canvasContent = useMemo(() => {
    if (isHeadingFlowCanvasStep) {
      // 旧 model (blog_creation_step7) のタイル: バージョン管理で選ばれた内容をそのまま表示
      if (isViewingPastHeadingContent) {
        return (canvasStreamingContent || activeCanvasVersion?.content) ?? '';
      }
      if (headingCanvasViewMode.isCombinedView) {
        const effectiveVersionId =
          activeVersionId ?? pendingCombinedVersionIdRef.current;
        if (effectiveVersionId === activeVersionId) {
          pendingCombinedVersionIdRef.current = null;
        }
        const foundVersion =
          combinedContentVersions.find(v => v.id === effectiveVersionId) ??
          (effectiveVersionId != null
            ? combinedContentVersions.find(v => String(v.id) === String(effectiveVersionId))
            : undefined);
        const combined =
          foundVersion?.content ??
          (combinedContentVersions.length > 0
            ? combinedContentVersions[combinedContentVersions.length - 1]?.content
            : null) ??
          latestCombinedContent ??
          '';
        if (combined.trim()) return combined;
        // 恒久対応: タイルクリック直後の state 更新遅延による空表示を防止（pendingCombinedContentRef を優先消費）
        const pendingContent = pendingCombinedContentRef.current;
        if (pendingContent != null && pendingContent.trim()) {
          pendingCombinedContentRef.current = null;
          return pendingContent;
        }
        // 本文作成未実施時: 書き出し案＋見出しセクションから結合フォールバックを表示（スキップで開いたときの空表示を防止）
        if (combinedContentVersions.length === 0 && headingSections.length > 0) {
          const sectionContents = headingSections
            .map(s => {
              const hashes = '#'.repeat(s.headingLevel);
              return `${hashes} ${s.headingText}\n\n${(s.content || '').trim()}`;
            })
            .join('\n\n')
            .trim();
          if (sectionContents) {
            const lead = step6ToStep7Lead.content?.trim();
            return lead ? `${lead}\n\n${sectionContents}` : sectionContents;
          }
        }
        // combined が空でも完成形データがあれば表示（ID不一致・遅延などの保険）
        const combinedFallback =
          latestCombinedContent?.trim() ||
          combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
          '';
        const result = combinedFallback || combined;
        return result;
      }
      // 見出し遷移直後は前見出し本文を表示しない（誤保存防止）。表示中がアクティブでなければ stale を無視
      if (
        isStep6ContentStale &&
        viewingHeadingIndex !== null &&
        viewingHeadingIndex === activeHeadingIndex
      ) {
        return '';
      }
      const idx = viewingHeadingIndex ?? 0;
      if (idx >= 0 && idx < headingSections.length) {
        const section = headingSections[idx];
        if (section?.isConfirmed && section.content) {
          const hashes = '#'.repeat(section.headingLevel);
          return `${hashes} ${section.headingText}\n\n${section.content}`;
        }
        const allSectionsEmpty = headingSections.every(s => !s.content || s.content.trim() === '');
        // 未確定見出し: canvasStreamingContent または getLatestStep7HeadingContent を優先
        // （blog_creation_step7_hN はバージョン管理対象外のため activeCanvasVersion に含まれない）
        if (canvasStreamingContent?.trim()) {
          const hashes = '#'.repeat(section?.headingLevel ?? 3);
          return `${hashes} ${section?.headingText ?? ''}\n\n${canvasStreamingContent}`;
        }
        const fromChat = getLatestStep7HeadingContent(
          allMessagesForVersions,
          idx,
          minTsForContentCheck
        );
        if (fromChat?.trim()) {
          const hashes = '#'.repeat(section?.headingLevel ?? 3);
          return `${hashes} ${section?.headingText ?? ''}\n\n${fromChat}`;
        }
        if (allSectionsEmpty && activeCanvasVersion?.content?.trim()) {
          // 書き出し案送信直後の旧バージョンのみ非表示。今回の生成内容はCanvasに表示する
          const versionCreatedMs = activeCanvasVersion?.createdAtIso
            ? new Date(activeCanvasVersion.createdAtIso).getTime()
            : (activeCanvasVersion?.createdAt ?? 0);
          const sectionsCreatedMs = Math.min(
            ...headingSections.map(s => (s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity))
          );
          if (sectionsCreatedMs !== Infinity && versionCreatedMs < sectionsCreatedMs) {
            // 旧バージョン → 非表示。ただし既存完成形があれば表示（選択バージョン反映）
            if (combinedContentVersions.length > 0) {
              const byId =
                activeVersionId != null
                  ? combinedContentVersions.find(
                      v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
                    )?.content?.trim()
                  : null;
              const cv =
                byId ||
                latestCombinedContent?.trim() ||
                combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
                '';
              if (cv) return cv;
            }
            return '';
          }
        } else if (allSectionsEmpty) {
          // 見出し本文が空でも、既存完成形（session_combined_contents）があれば表示。バージョン選択反映。
          if (combinedContentVersions.length > 0) {
            const byId =
              activeVersionId != null
                ? combinedContentVersions.find(
                    v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
                  )?.content?.trim()
                : null;
            const cv =
              byId ||
              latestCombinedContent?.trim() ||
              combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
              '';
            if (cv) return cv;
          }
          return '';
        }
      }
      // Step7 のみ: 上記で解決できなかった場合の最終フォールバック（空表示の恒久防止）。バージョン選択反映。
      if (combinedContentVersions.length > 0) {
        const byId =
          activeVersionId != null
            ? combinedContentVersions.find(
                v => v.id === activeVersionId || String(v.id) === String(activeVersionId)
              )?.content?.trim()
            : null;
        const fallback =
          byId ||
          latestCombinedContent?.trim() ||
          combinedContentVersions[combinedContentVersions.length - 1]?.content?.trim() ||
          '';
        if (fallback) return fallback;
      }
      const finalFallback = activeCanvasVersion?.content ?? '';
      return finalFallback;
    }
    // 未確定の場合は最新のバージョン（生成中の内容含む）を表示
    const finalContent = activeCanvasVersion?.content ?? '';
    return finalContent;
  }, [
    isHeadingFlowCanvasStep,
    isViewingPastHeadingContent,
    canvasStreamingContent,
    headingCanvasViewMode.isCombinedView,
    headingSections,
    combinedContentVersions,
    activeVersionId,
    latestCombinedContent,
    step6ToStep7Lead.content,
    activeCanvasVersion,
    isStep6ContentStale,
    viewingHeadingIndex,
    activeHeadingIndex,
    allMessagesForVersions,
    getLatestStep7HeadingContent,
    minTsForContentCheck,
  ]);

  const isCombinedFormView = headingCanvasViewMode.isCombinedView;
  const isHeadingUnitStep7View = headingCanvasViewMode.isViewingHeading;
  const isCombinedFormViewWithVersions = isCombinedFormView && combinedContentVersions.length > 0;

  // 他ステップと同様: canvasVersionsForStep をベースに。Step7 見出し単体のみバージョン管理なし
  const canvasVersionsWithMeta = useMemo(() => {
    if (isHeadingUnitStep7View) return [];
    if (isCombinedFormView && combinedContentVersions.length === 0) {
      return []; // 完成形未取得時はバージョンUI非表示（本文ソースとの不整合を防止）
    }
    if (isCombinedFormViewWithVersions) {
      return combinedContentVersions.map(v => ({
        id: v.id,
        content: v.content,
        versionNumber: v.versionNo,
        isLatest: v.isLatest,
      }));
    }
    return canvasVersionsForStep.map((version, index) => ({
      ...version,
      versionNumber: index + 1,
      isLatest: index === canvasVersionsForStep.length - 1,
    }));
  }, [
    isHeadingUnitStep7View,
    isCombinedFormView,
    isCombinedFormViewWithVersions,
    combinedContentVersions,
    canvasVersionsForStep,
  ]);

  const canvasStepOptions = useMemo(() => {
    // バージョンが1件以上あるステップを表示（nextStepForPlaceholder では除外しない）
    const base = BLOG_STEP_IDS.filter(
      step => (blogCanvasVersionsByStep[step] ?? []).length > 0
    );
    // Step7 完成形は session_combined_contents に保存されるため、combinedContentVersions があれば追加
    if (!base.includes(HEADING_FLOW_STEP_ID) && combinedContentVersions.length > 0) {
      return [...base, HEADING_FLOW_STEP_ID];
    }
    return base;
  }, [blogCanvasVersionsByStep, combinedContentVersions.length]);

  // Step7 完成形タイル: 各バージョンをタイル化。createdAt で時系列マージ用
  const combinedTiles = useMemo(
    () =>
      combinedContentVersions.map(v => {
        const { title, excerpt } = deriveTileFromContent(v.content);
        return {
          id: v.id,
          title,
          excerpt,
          ...(v.createdAt != null && { createdAt: v.createdAt }),
        };
      }),
    [combinedContentVersions]
  );

  // handleSaveHeadingSection はフック側のシグネチャが (content: string, overrideHeadingKey?: string) のため、ここでラップする。
  // CanvasPanel が contentRef に表示中の内容を随時更新するため、保存時は ref を優先して
  // ストリーミング完了直後のクリックでも最新編集内容が保存される。
  // 見出し+本文で表示されている場合、保存時は見出し行を除去して本文のみを渡す（combineSections で二重化防止）
  const viewingSection =
    viewingHeadingIndex !== null &&
    viewingHeadingIndex >= 0 &&
    viewingHeadingIndex < headingSections.length
      ? headingSections[viewingHeadingIndex]
      : undefined;

  const handleSaveHeadingClick = useCallback(async () => {
    if (saveHeadingInFlightRef.current) return;
    if (isStep6ContentStale) return;
    // StepActionBar 保存は常に active（最初の未確定）見出しに保存する。表示中の見出しと乖離していても正しい。
    if (activeHeadingIndex === undefined || !activeHeading) return;
    saveHeadingInFlightRef.current = true;
    const section = activeHeading;
    const sectionsMinUpdatedMs =
      headingSections.length > 0
        ? Math.min(
            ...headingSections.map(s =>
              s.updatedAt ? new Date(s.updatedAt).getTime() : Infinity
            )
          )
        : 0;
    const minTs = sectionsMinUpdatedMs !== Infinity ? sectionsMinUpdatedMs : undefined;
    const isViewingTargetInCanvas =
      canvasPanelOpen && effectiveViewingHeadingIndex === activeHeadingIndex;
    let rawContent: string | undefined;
    if (isViewingTargetInCanvas) {
      // 仕様 8.8: contentRef ?? canvasStreamingContent ?? canvasContent
      // ?? 使用で空文字列はフォールバックしない（意図的全削除を保持）。空は後段のバリデーションで拒否。
      const resolved =
        canvasContentRef.current ??
        canvasStreamingContent ??
        canvasContent;
      rawContent = resolved !== undefined && resolved !== null ? resolved : undefined;
    } else {
      // 対象見出しを表示していない場合、Canvas表示内容は別見出しのものなので使わない
      rawContent = getLatestStep7HeadingContent(
        allMessagesForVersions,
        activeHeadingIndex,
        minTs
      ) ?? undefined;
    }
    if (!rawContent?.trim()) {
      saveHeadingInFlightRef.current = false;
      setIsStep6ContentStale(true);
      toast.error(
        '最後の見出しの本文が見つかりません。Canvas に表示されている内容を確認し、見出し生成をもう一度実行してください。'
      );
      return;
    }
    const contentToSave =
      section && rawContent ? stripLeadingHeadingLine(rawContent, section.headingText) : rawContent;

    if (!contentToSave?.trim()) {
      saveHeadingInFlightRef.current = false;
      return;
    }
    try {
      const success = await handleSaveHeadingSectionFromFlow(contentToSave, section.headingKey);
      if (success) {
        setCanvasStreamingContent('');
      }
    } finally {
      saveHeadingInFlightRef.current = false;
    }
  }, [
    isStep6ContentStale,
    activeHeadingIndex,
    activeHeading,
    headingSections,
    canvasPanelOpen,
    effectiveViewingHeadingIndex,
    allMessagesForVersions,
    getLatestStep7HeadingContent,
    handleSaveHeadingSectionFromFlow,
    canvasStreamingContent,
    canvasContent,
  ]);

  /** 全見出し保存後: AI で本文生成（blog_creation_step7）し、session_combined_contents に保存 */
  const handleBuildCombinedOnly = useCallback(async () => {
    if (buildCombinedInFlightRef.current) return;
    buildCombinedInFlightRef.current = true;
    setCanvasStreamingContent('');
    setIsBuildingCombined(true);
    try {
      if (!chatSession.state.currentSessionId) {
        toast.error('セッションがありません。チャットを再度読み込んでください。');
        return;
      }
      const token = await getAccessToken();
      if (!token?.trim()) {
        toast.error('認証トークンを取得できませんでした。LINEで再ログインしてください。');
        return;
      }
      const res = await getCombinedContentForStep7({
        sessionId: chatSession.state.currentSessionId,
        liffAccessToken: token,
      });
      if (!res.success || res.content == null) {
        toast.error(
          res.error ?? '完成形の構築に失敗しました。書き出し案の入力を再度お試しください。'
        );
        return;
      }
      if (!res.content.trim()) {
        toast.error('結合する見出し本文がありません。各見出しを保存してから再度お試しください。');
        return;
      }

      setSelectedModel('blog_creation');
      const serviceOpts = selectedServiceId ? { serviceId: selectedServiceId } : undefined;
      const sendOk = await chatSession.actions.sendMessage(res.content, toBlogModel(HEADING_FLOW_STEP_ID), {
        ...serviceOpts,
        step7FullBodyGeneration: true,
      });
      if (!sendOk) {
        toast.error('完成形の生成・保存に失敗しました。チャットのエラー表示をご確認ください。');
        return;
      }

      resetCombinedVersionToLatest();
      setSelectedVersionByStep(prev => ({
        ...prev,
        [HEADING_FLOW_STEP_ID]: null,
      }));
      await refetchCombinedContentVersions({ force: true });
      await chatSession.actions.loadSession(chatSession.state.currentSessionId);
      toast.success('完成形をAIで生成し、保存しました');
      openCombinedCanvasRef.current();
    } catch (error) {
      console.error('Failed to build combined content:', error);
      toast.error(
        error instanceof Error ? error.message : '完成形の構築に失敗しました。しばらく経ってから再度お試しください。'
      );
    } finally {
      buildCombinedInFlightRef.current = false;
      setIsBuildingCombined(false);
    }
  }, [
    chatSession.state.currentSessionId,
    chatSession.actions,
    getAccessToken,
    selectedServiceId,
    resetCombinedVersionToLatest,
    refetchCombinedContentVersions,
    setSelectedVersionByStep,
  ]);

  const handleBeforeManualStepChange = useCallback((): boolean => true, []);

  // スキップ/バック時に resolvedCanvasStep を同期（見出しフロー・Canvas コンテンツの表示に必要）
  const handleManualStepChangeForCanvas = useCallback(
    (targetStep: BlogStepId) => {
      setIsViewingPastHeadingContent(false);
      setCanvasStreamingContent('');
      setCanvasStep(targetStep);
      if (targetStep === STEP6_ID || targetStep === HEADING_FLOW_STEP_ID) {
        setCanvasPanelOpen(true);
      }
      // Step7 へ遷移かつ未確定見出しあり → 完成形ではなく見出し1を表示
      // 完成形は全見出し確定時のみ存在。未確定があれば完成形は存在せず、取得中かどうかに依存しない。
      if (
        targetStep === HEADING_FLOW_STEP_ID &&
        headingSections.length > 0 &&
        activeHeadingIndex !== undefined
      ) {
        pendingViewingIndexRef.current = 0;
      }
    },
    [setCanvasStreamingContent, headingSections, activeHeadingIndex]
  );

  // 履歴ベースのモデル自動検出は削除（InputArea 側でフロー状態から自動選択）

  // StepActionBarのrefを定義
  const stepActionBarRef = useRef<StepActionBarRef>(null);

  // モデル変更ハンドラ
  const handleModelChange = useCallback((model: string, step?: BlogStepId) => {
    void step;
    setSelectedModel(model);
  }, []);

  // nextStepの変更ハンドラ
  const handleNextStepChange = useCallback((nextStep: BlogStepId | null) => {
    setNextStepForPlaceholder(nextStep);
  }, []);

  // BlogFlow起動ガード（モデル選択と連動）
  const blogFlowActive =
    !subscription.requiresSubscription &&
    !!chatSession.state.currentSessionId &&
    selectedModel === 'blog_creation';

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
  }, [latestBlogStep, selectedModel]);

  // ✅ メッセージ送信時に初期化を実行
  const handleSendMessage = useCallback(
    async (content: string, model: string) => {
      // 新規メッセージ送信時はプレースホルダー状態をリセット
      setNextStepForPlaceholder(null);
      // 選択中のサービスIDがあれば常に渡して、セッション更新の競合を避ける
      const options = selectedServiceId ? { serviceId: selectedServiceId } : undefined;

      await chatSession.actions.sendMessage(content, model, options);
    },
    [chatSession.actions, selectedServiceId]
  );

  /** Step6→Step7: 書き出し案を保存のみ（AI呼び出しなし）。成功時に step7 表示に遷移。 */
  const handleSaveStep7UserLead = useCallback(
    async (userLead: string) => {
      try {
        if (!chatSession.state.currentSessionId) {
          return { success: false, error: 'セッションが見つかりません' };
        }
        const token = await getAccessToken();
        if (!token?.trim()) {
          return { success: false, error: '認証トークンが無効です' };
        }
        const res = await saveStep7UserLead({
          sessionId: chatSession.state.currentSessionId,
          userLead: userLead.trim(),
          liffAccessToken: token,
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
    [chatSession.state.currentSessionId, chatSession.actions, getAccessToken]
  );

  // ✅ 見出し単位生成: スタート/この見出しを生成ボタンでチャット送信の代わりに生成開始。
  // headingIndex を model に含めることで、タイルクリック時に該当見出しを正しく開けるようにする。
  const handleStartHeadingGeneration = useCallback(
    (headingIndex: number) => {
      pendingAutoOpenHeadingRef.current = true;
      setSelectedModel('blog_creation');
      const model =
        Number.isInteger(headingIndex) && headingIndex >= 0
          ? getStep7HeadingModel(headingIndex)
          : toBlogModel(HEADING_FLOW_STEP_ID);
      void handleSendMessage('この見出しの本文を書いてください', model);
    },
    [handleSendMessage]
  );

  // ✅ Canvasボタンクリック時にCanvasPanelを表示する関数
  const handleShowCanvas = useCallback(
    (message: ChatMessage) => {
      const fallbackStep = (latestBlogStep ?? BLOG_STEP_IDS[0]) as BlogStepId;
      const detectedStep = (getContentStepFromAssistantModel(message.model, message.content) ?? fallbackStep) as BlogStepId;

      // Step7 見出しタイル: 編集中の見出しに未保存コンテンツがある場合は他見出しへの切り替えを禁止
      if (detectedStep === HEADING_FLOW_STEP_ID && headingSections.length > 0) {
        const targetIdx = extractStep7HeadingIndexFromModel(message.model);
        const validTargetIdx =
          targetIdx !== null && targetIdx >= 0 && targetIdx < headingSections.length
            ? targetIdx
            : null;
        if (
          validTargetIdx !== null &&
          activeHeadingIndex !== undefined &&
          validTargetIdx !== activeHeadingIndex
        ) {
          const section = headingSections[activeHeadingIndex];
          if (hasContentForActiveHeading && !section?.isConfirmed) {
            toast.error('編集中の見出しを保存してから、他の見出しを開けます。');
            return;
          }
        }
      }

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
      if (detectedStep === HEADING_FLOW_STEP_ID && headingSections.length > 0) {
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
      activeHeadingIndex,
      annotationOpen,
      blogCanvasVersionsByStep,
      hasContentForActiveHeading,
      headingSections,
      isHeadingFlowCanvasStep,
      latestBlogStep,
      setCanvasStreamingContent,
      setViewingHeadingIndex,
      setAnnotationData,
      setFollowLatestByStep,
      setSelectedVersionByStep,
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
  }, [chatSession.state.isLoading, chatSession.state.messages, handleShowCanvas]);

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
      setCanvasStep(HEADING_FLOW_STEP_ID);
      setCanvasStreamingContent('');
      setSelectedVersionByStep(prev => ({
        ...prev,
        [HEADING_FLOW_STEP_ID]: versionId ?? null,
      }));
      // 特定バージョン選択時は追従を無効化し、effect による選択上書きを防止
      if (versionId) {
        setFollowLatestByStep(prev => ({
          ...prev,
          [HEADING_FLOW_STEP_ID]: false,
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
    ]
  );

  openCombinedCanvasRef.current = handleOpenCombinedCanvas;

  // ✅ 保存ボタンクリック時にAnnotationPanelを表示する関数
  const handleOpenAnnotation = async () => {
    if (!chatSession.state.currentSessionId) return;

    setAnnotationLoading(true);
    try {
      // データベースから既存のアノテーションデータを取得
      const res = await getContentAnnotationBySession(chatSession.state.currentSessionId);
      if (res.success && res.data) {
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

  const handleCanvasVersionSelect = useCallback(
    (versionId: string) => {
      const step = resolvedCanvasStep;
      if (!step) return;
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;

      setCanvasStreamingContent('');
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
      setCanvasStreamingContent('');
      if (step === HEADING_FLOW_STEP_ID && combinedContentVersions.length > 0) {
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
      setCanvasStreamingContent,
      setFollowLatestByStep,
      setSelectedVersionByStep,
      setViewingHeadingIndex,
    ]
  );

  const handleCanvasStepSelect = useCallback(
    (stepId: string) => {
      if (!isBlogStepId(stepId)) return;
      handleCanvasStepChange(stepId);
    },
    [handleCanvasStepChange]
  );

  const handleCanvasSelectionEdit = useCallback(
    async (payload: CanvasSelectionEditPayload): Promise<CanvasSelectionEditResult> => {
      if (isOwnerViewMode) {
        throw new Error('閲覧モードでは編集できません');
      }
      if (canvasEditInFlightRef.current) {
        throw new Error('他のAI編集が進行中です。完了をお待ちください。');
      }

      canvasEditInFlightRef.current = true;
      setIsCanvasStreaming(true);

      try {
        // キャンバスパネルはブログ作成専用のため、常にブログ作成モデルを使用
        let targetStep: BlogStepId;

        // Canvasで選択されているステップを優先（過去のステップからの改善に対応）
        if (resolvedCanvasStep) {
          targetStep = resolvedCanvasStep;
        } else {
          const stepInfo = stepActionBarRef.current?.getCurrentStepInfo();
          targetStep = stepInfo?.currentStep ?? latestBlogStep ?? FIRST_BLOG_STEP_ID;
        }

        const extendedPayload = payload as CanvasSelectionEditPayload & {
          freeFormUserPrompt?: string;
        };
        const freeFormUserPrompt = extendedPayload.freeFormUserPrompt?.trim();
        // 自由記載の場合のみキーワードに応じてWeb検索を切り替える
        const shouldEnableWebSearch =
          freeFormUserPrompt !== undefined ? freeFormUserPrompt.includes('検索') : true;

        const instruction = payload.instruction.trim();
        const selectedText = payload.selectedText.trim();
        const step7ViewModeForRequest = resolveHeadingCanvasViewMode({
          step: targetStep,
          headingCount: headingSections.length,
          viewingHeadingIndex,
          activeHeadingIndex,
        });
        const headingContextIndex = step7ViewModeForRequest.headingIndex;
        const canvasModel =
          targetStep === HEADING_FLOW_STEP_ID && headingContextIndex !== null
            ? `blog_creation_${targetStep}_h${headingContextIndex}`
            : `blog_creation_${targetStep}`;

        // canvasContentの検証
        if (!payload.canvasContent || payload.canvasContent.trim() === '') {
          throw new Error('キャンバスコンテンツが空です。編集対象が見つかりませんでした。');
        }

        // セッションIDの検証
        if (!chatSession.state.currentSessionId) {
          throw new Error('セッションIDが見つかりません');
        }

        // アクセストークン取得
        const accessToken = await getAccessToken();

        // ストリーミングコンテンツをリセット
        setCanvasStreamingContent('');

        // ✅ 楽観的更新: ストリーミング開始時に2つのメッセージを追加
        // 1つ目: BlogPreviewTile用（Canvas編集結果）
        // 2つ目: 分析結果用（通常のチャット）
        const tempAssistantCanvasId = `temp-assistant-canvas-${Date.now()}`;
        const tempAssistantAnalysisId = `temp-assistant-analysis-${Date.now() + 1}`;
        const userMessage: ChatMessage = {
          id: `temp-user-${Date.now()}`,
          role: 'user',
          content: instruction,
          timestamp: new Date(),
          model: canvasModel,
        };

        const assistantCanvasMessage: ChatMessage = {
          id: tempAssistantCanvasId,
          role: 'assistant',
          content: '', // ストリーミング中は空
          timestamp: new Date(),
          model: canvasModel,
        };

        const assistantAnalysisMessage: ChatMessage = {
          id: tempAssistantAnalysisId,
          role: 'assistant',
          content: '', // ストリーミング中は空
          timestamp: new Date(),
          model: 'blog_creation_improvement', // 分析結果用のモデル
        };

        setOptimisticMessages([userMessage, assistantCanvasMessage, assistantAnalysisMessage]);

        if (annotationOpen) {
          setAnnotationOpen(false);
          setAnnotationData(null);
        }

        setCanvasStep(targetStep);
        setSelectedVersionByStep(prev => ({
          ...prev,
          [targetStep]: null,
        }));
        setFollowLatestByStep(prev => ({
          ...prev,
          [targetStep]: false,
        }));
        setCanvasStreamingContent('');
        setCanvasPanelOpen(true);

        const markdownDecoder = createFullMarkdownDecoder();

        // ✅ ストリーミングAPI呼び出し（必要に応じてWeb検索を利用）
        // 見出し単位 = 未確定の見出し編集中 OR 確定済み見出しの再編集（戻るで遷移）。完成形表示時は false
        const isHeadingUnit = step7ViewModeForRequest.isHeadingUnit;

        const response = await fetch('/api/chat/canvas/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            sessionId: chatSession.state.currentSessionId,
            instruction,
            selectedText,
            canvasContent: payload.canvasContent,
            targetStep,
            enableWebSearch: shouldEnableWebSearch,
            ...(isHeadingUnit && { isHeadingUnit: true }),
            ...(headingContextIndex !== null && { step7HeadingIndex: headingContextIndex }),
            webSearchConfig: {
              maxUses: 3,
            },
            ...(freeFormUserPrompt !== undefined && { freeFormUserPrompt }),
          }),
        });

        if (!response.ok) {
          throw new Error(`ストリーミングAPIエラー: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('ストリーミングレスポンスの取得に失敗しました');
        }

        let buffer = '';
        let fullMarkdown = '';
        let analysisResult = '';

        const processEventBlock = (block: string) => {
          if (!block.trim() || block.startsWith(': ')) {
            return;
          }

          const eventMatch = block.match(/^event: (.+)$/m);
          const dataMatch = block.match(/^data: (.+)$/m);

          if (!eventMatch || !dataMatch || !eventMatch[1] || !dataMatch[1]) {
            return;
          }

          const eventType = eventMatch[1];
          let eventData: unknown;

          try {
            eventData = JSON.parse(dataMatch[1]);
          } catch (error) {
            console.error('Failed to parse SSE data payload', error, { raw: dataMatch[1] });
            return;
          }

          if (eventType === 'chunk' && typeof eventData === 'object' && eventData !== null) {
            const decodedMarkdown = markdownDecoder.feed(
              (eventData as { content?: string }).content ?? ''
            );
            fullMarkdown = decodedMarkdown;
            setCanvasStreamingContent(decodedMarkdown);
            setOptimisticMessages(prev =>
              prev.map(msg =>
                msg.id === tempAssistantCanvasId ? { ...msg, content: decodedMarkdown } : msg
              )
            );
            return;
          }

          if (
            eventType === 'analysis_chunk' &&
            typeof eventData === 'object' &&
            eventData !== null
          ) {
            analysisResult += (eventData as { content?: string }).content ?? '';
            setOptimisticMessages(prev =>
              prev.map(msg =>
                msg.id === tempAssistantAnalysisId ? { ...msg, content: analysisResult } : msg
              )
            );
            return;
          }

          if (eventType === 'done' && typeof eventData === 'object' && eventData !== null) {
            fullMarkdown = (eventData as { fullMarkdown?: string }).fullMarkdown ?? fullMarkdown;
            analysisResult = (eventData as { analysis?: string }).analysis ?? analysisResult;
            setCanvasStreamingContent(fullMarkdown);
            setOptimisticMessages(prev =>
              prev.map(msg => {
                if (msg.id === tempAssistantCanvasId) {
                  return { ...msg, content: fullMarkdown };
                }
                if (msg.id === tempAssistantAnalysisId) {
                  return { ...msg, content: analysisResult };
                }
                return msg;
              })
            );
            return;
          }

          if (eventType === 'error' && typeof eventData === 'object' && eventData !== null) {
            const message =
              (eventData as { message?: string }).message || 'ストリーミングエラーが発生しました';
            throw new Error(message);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            processEventBlock(line);
          }
        }

        if (buffer.trim()) {
          processEventBlock(buffer);
          buffer = '';
        }

        handleModelChange('blog_creation', targetStep);

        // セッションを再読み込みして最新メッセージを取得
        await chatSession.actions.loadSession(chatSession.state.currentSessionId);

        // Step6 完成形の Canvas 編集時は session_combined_contents に新バージョンが保存されているため再取得
        if (
          targetStep === HEADING_FLOW_STEP_ID &&
          headingSections.length > 0 &&
          headingSections.every(s => s.isConfirmed)
        ) {
          refetchCombinedContentVersions();
        }

        // 楽観的更新をクリア（実際のメッセージで置き換え）
        setOptimisticMessages([]);

        // 通常のブログ作成と同じように、新しいメッセージがチャットに表示される
        // ユーザーはBlogPreviewTileをクリックしてCanvasを開く
        return { replacementHtml: '' };
      } catch (error) {
        console.error('Canvas selection edit failed:', error);
        // エラー時も楽観的更新をクリア
        setOptimisticMessages([]);
        throw error instanceof Error ? error : new Error('AI編集の処理に失敗しました');
      } finally {
        canvasEditInFlightRef.current = false;
        setCanvasStreamingContent('');
        setIsCanvasStreaming(false);
      }
    },
    [
      activeHeadingIndex,
      annotationOpen,
      chatSession.actions,
      chatSession.state.currentSessionId,
      getAccessToken,
      handleModelChange,
      headingSections,
      isOwnerViewMode,
      latestBlogStep,
      refetchCombinedContentVersions,
      resolvedCanvasStep,
      viewingHeadingIndex,
      setAnnotationData,
      setAnnotationOpen,
      setCanvasPanelOpen,
      setCanvasStep,
      setFollowLatestByStep,
      setOptimisticMessages,
      setCanvasStreamingContent,
      setSelectedVersionByStep,
    ]
  );

  return (
    <div className="flex h-[calc(100vh-3rem)]" data-testid="chat-layout">
      <ChatLayoutContent
        ctx={{
          chatSession,
          subscription,
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
          ...(isHeadingFlowCanvasStep && { isStep7SaveDisabled: isStep6ContentStale }),
          onStartHeadingGeneration: handleStartHeadingGeneration,
          onSaveHeadingSection: handleSaveHeadingClick,
          onBuildCombinedOnly: handleBuildCombinedOnly,
          isChatLoading: chatSession.state.isLoading,
          isBuildingCombined,
          onSaveStep7UserLead: handleSaveStep7UserLead,
          step6ToStep7LeadSaved,
          ...(combinedTiles.length > 0 && { combinedTiles }),
          onOpenCombinedCanvas: handleOpenCombinedCanvas,
        }}
      />
      {canvasPanelOpen && (
        <CanvasPanel
          onClose={() => {
            setCanvasPanelOpen(false);
          }}
          content={canvasContent}
          isVisible={canvasPanelOpen}
          {...(isOwnerViewMode ? {} : { onSelectionEdit: handleCanvasSelectionEdit })}
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
