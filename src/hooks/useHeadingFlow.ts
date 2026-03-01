'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { extractHeadingsFromMarkdown } from '@/lib/heading-extractor';
import * as headingActions from '@/server/actions/heading-flow.actions';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { type BlogStepId, HEADING_FLOW_STEP_ID } from '@/lib/constants';

interface UseHeadingFlowParams {
  sessionId: string | null;
  isSessionLoading: boolean;
  step5Content: string | null;
  getAccessToken: () => Promise<string>;
  resolvedCanvasStep: BlogStepId | null;
}

/** 完成形の1バージョン（session_combined_contents 由来） */
export interface CombinedContentVersion {
  id: string;
  versionNo: number;
  content: string;
  isLatest: boolean;
}

interface UseHeadingFlowReturn {
  headingSections: SessionHeadingSection[];
  isSavingHeading: boolean;
  isHeadingInitInFlight: boolean;
  hasAttemptedHeadingInit: boolean;
  headingInitError: string | null;
  headingSaveError: string | null;
  activeHeadingIndex: number | undefined;
  activeHeading: SessionHeadingSection | undefined;
  latestCombinedContent: string | null;
  /** 完成形の全バージョン一覧（version_no 降順）。バージョン管理UI用 */
  combinedContentVersions: CombinedContentVersion[];
  /** 選択中のバージョンID。null は最新を表示 */
  selectedCombinedVersionId: string | null;
  /** 選択バージョンに応じた完成形コンテンツ。完成形表示時に使用 */
  selectedCombinedContent: string | null;
  handleCombinedVersionSelect: (versionId: string) => void;
  /** 完成形のバージョン一覧と最新を再取得（Canvas編集完了後など） */
  refetchCombinedContentVersions: (targetSections?: SessionHeadingSection[]) => void;
  /**
   * 見出しセクションを保存する。
   * @param content 保存するコンテンツ（canvasStreamingContent || canvasContent）
   * @param overrideHeadingKey 指定時はその見出しを保存（再編集用）。未指定時は activeHeading を保存
   */
  handleSaveHeadingSection: (content: string, overrideHeadingKey?: string) => Promise<boolean>;
  handleRetryHeadingInit: (options?: { fromReset?: boolean }) => void;
  /** 見出し確定内容から完成形を再生成して新バージョン保存する */
  handleRebuildCombinedContent: () => Promise<boolean>;
  isRebuildingCombinedContent: boolean;
  /** 見出しセクションの状態を強制的に再取得する（保存・確定後の同期用） */
  refetchHeadings: () => Promise<SessionHeadingSection[]>;
}

export function useHeadingFlow({
  sessionId,
  isSessionLoading,
  step5Content,
  getAccessToken,
  resolvedCanvasStep,
}: UseHeadingFlowParams): UseHeadingFlowReturn {
  const [headingSections, setHeadingSections] = useState<SessionHeadingSection[]>([]);
  const [isSavingHeading, setIsSavingHeading] = useState(false);
  const [isHeadingInitInFlight, setIsHeadingInitInFlight] = useState(false);
  const [hasAttemptedHeadingInit, setHasAttemptedHeadingInit] = useState(false);
  const [headingInitError, setHeadingInitError] = useState<string | null>(null);
  const [headingSaveError, setHeadingSaveError] = useState<string | null>(null);
  const [latestCombinedContent, setLatestCombinedContent] = useState<string | null>(null);
  const [combinedContentVersions, setCombinedContentVersions] = useState<
    Array<{ id: string; versionNo: number; content: string; isLatest: boolean }>
  >([]);
  const [selectedCombinedVersionId, setSelectedCombinedVersionId] = useState<string | null>(null);
  const [isRebuildingCombinedContent, setIsRebuildingCombinedContent] = useState(false);
  // セッション切り替え直後の fetch 完了を待つフラグ。
  // false の間は初期化 effect が走らないようにブロックする。
  const [hasFetchCompleted, setHasFetchCompleted] = useState(false);

  /** 指定されたステップが見出し単位生成フロー（step7）の対象かどうか */
  const isHeadingFlowActive = useCallback(
    (step: BlogStepId | null): boolean => {
      return step === HEADING_FLOW_STEP_ID;
    },
    []
  );

  // セッション切り替え時の競合防止用 ref
  const currentSessionIdRef = useRef(sessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);

  // step5Content が null のまま init した場合、後から content が入ったら再試行を許可する
  const didInitWithStep5ContentRef = useRef(false);
  /** 最後に init を試行した step5Content。更新検知による無限ループ防止用 */
  const lastInitStep5ContentRef = useRef<string | null>(null);
  /** 構成リセット後に init が成功したら完了トーストを表示するためのフラグ */
  const isResetInitRef = useRef(false);

  const activeHeadingIndex = useMemo(() => {
    if (headingSections.length === 0) return undefined;
    const index = headingSections.findIndex(s => !s.isConfirmed);
    // 未確定がなければ全確定済み → アクティブな見出しなし
    return index >= 0 ? index : undefined;
  }, [headingSections]);

  const activeHeading =
    activeHeadingIndex !== undefined ? headingSections[activeHeadingIndex] : undefined;

  const fetchHeadingSections = useCallback(
    async (sid: string): Promise<SessionHeadingSection[]> => {
      const liffAccessToken = await getAccessToken();
      if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
        return [];
      }
      const res = await headingActions.getHeadingSections({
        sessionId: sid,
        liffAccessToken: liffAccessToken.trim(),
      });
      // セッション切り替え時の競合防止
      if (res.success && res.data && sid === currentSessionIdRef.current) {
        setHeadingSections(res.data);
        return res.data;
      }
      return [];
    },
    [getAccessToken]
  );

  const fetchLatestCombinedContent = useCallback(
    async (sid: string): Promise<void> => {
      const liffAccessToken = await getAccessToken();
      if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
        return;
      }
      const res = await headingActions.getLatestCombinedContent({
        sessionId: sid,
        liffAccessToken: liffAccessToken.trim(),
      });
      if (res.success && sid === currentSessionIdRef.current) {
        setLatestCombinedContent(res.data ?? null);
      }
    },
    [getAccessToken]
  );

  const fetchCombinedContentVersions = useCallback(
    async (sid: string): Promise<void> => {
      const liffAccessToken = await getAccessToken();
      if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
        return;
      }
      const res = await headingActions.getCombinedContentVersions({
        sessionId: sid,
        liffAccessToken: liffAccessToken.trim(),
      });
      if (res.success && sid === currentSessionIdRef.current) {
        setCombinedContentVersions(res.data);
      }
    },
    [getAccessToken]
  );

  // セッション切り替え時にステートをリセットして最新データを取得
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSessionIdRef.current === sessionId) return;
    prevSessionIdRef.current = sessionId;

    setHeadingSections([]);
    setLatestCombinedContent(null);
    setCombinedContentVersions([]);
    setSelectedCombinedVersionId(null);
    setHasAttemptedHeadingInit(false);
    didInitWithStep5ContentRef.current = false;
    lastInitStep5ContentRef.current = null;
    isResetInitRef.current = false;
    setIsHeadingInitInFlight(false);
    setHeadingInitError(null);
    setHeadingSaveError(null);
    setHasFetchCompleted(false);
    if (sessionId) {
      void (async () => {
        const sections = await fetchHeadingSections(sessionId).catch(
          (err): SessionHeadingSection[] => {
            console.error('Failed to fetch heading sections on session switch:', err);
            return [];
          }
        );
        if (sessionId === currentSessionIdRef.current) {
          setHasFetchCompleted(true);
          // 全確定済みの場合は結合コンテンツ（最新＋バージョン一覧）を取得
          if (sections.length > 0 && sections.every(s => s.isConfirmed)) {
            void fetchLatestCombinedContent(sessionId);
            void fetchCombinedContentVersions(sessionId);
          }
        }
      })();
    } else {
      setHasFetchCompleted(true);
    }
  }, [sessionId, fetchHeadingSections, fetchLatestCombinedContent, fetchCombinedContentVersions]);

  useEffect(() => {
    if (resolvedCanvasStep !== HEADING_FLOW_STEP_ID) {
      setHeadingSaveError(null);
    }
  }, [resolvedCanvasStep]);

  // Step 7 入場時の自動初期化（構成案からの見出し抽出）
  useEffect(() => {
    // 1. Step 7 以外では自動初期化は行わない（Step 6 は見出し既存時のみ Flow になるが、新規抽出は行わない）
    // 2. 既存データがある場合や、ローディング中などはスキップ
    if (
      !sessionId ||
      resolvedCanvasStep !== HEADING_FLOW_STEP_ID ||
      isHeadingInitInFlight ||
      hasAttemptedHeadingInit ||
      isSessionLoading ||
      headingInitError ||
      !hasFetchCompleted
    ) {
      return;
    }

    const initAndFetch = async () => {
      setIsHeadingInitInFlight(true);
      try {
        // 見出し抽出元: メモ・補足情報の基本構成（content_annotations.basic_structure）を優先、
        // 見出しが抽出できない場合は最新の step5 構成案をフォールバック
        const trimmedStep5 = step5Content?.trim() ?? '';
        let outlineSource = trimmedStep5;

        const annotationRes = await getContentAnnotationBySession(sessionId);
        if (annotationRes.success && annotationRes.data?.basic_structure) {
          const trimmedBasic = annotationRes.data.basic_structure.trim();
          if (
            trimmedBasic &&
            extractHeadingsFromMarkdown(trimmedBasic).length > 0
          ) {
            outlineSource = trimmedBasic;
          }
        }

        if (outlineSource) {
          didInitWithStep5ContentRef.current = true;
          lastInitStep5ContentRef.current = outlineSource;
          const liffAccessToken = await getAccessToken();
          if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
            if (sessionId === currentSessionIdRef.current) {
              setHeadingInitError('認証トークンを取得できませんでした。LINEで再ログインしてください。');
            }
            return;
          }
          const res = await headingActions.initializeHeadingSections({
            sessionId,
            step5Markdown: outlineSource,
            liffAccessToken: liffAccessToken.trim(),
          });
          if (res.success) {
            const sections = await fetchHeadingSections(sessionId);
            if (sessionId === currentSessionIdRef.current) {
              setHeadingInitError(null);
              setHasAttemptedHeadingInit(true);
              if (sections.length > 0 && isResetInitRef.current) {
                isResetInitRef.current = false;
                toast.success('見出しを抽出しました');
              }
            }
          } else {
            console.error('Failed to initialize heading sections:', res.error);
            if (sessionId === currentSessionIdRef.current) {
              setHeadingInitError(res.error || '初期化に失敗しました');
            }
          }
        } else {
          // 基本構成も step5 もない、または見出しが抽出できない場合は「試行済み」としてループを止める
          if (sessionId === currentSessionIdRef.current) {
            setHasAttemptedHeadingInit(true);
          }
        }
      } catch (e) {
        console.error('Failed to initialize heading sections:', e);
        if (sessionId === currentSessionIdRef.current) {
          setHeadingInitError('予期せぬエラーが発生しました');
        }
      } finally {
        if (sessionId === currentSessionIdRef.current) {
          setIsHeadingInitInFlight(false);
          isResetInitRef.current = false;
        }
      }
    };

    void initAndFetch();
  }, [
    sessionId,
    resolvedCanvasStep,
    isHeadingInitInFlight,
    step5Content,
    isSessionLoading,
    fetchHeadingSections,
    getAccessToken,
    hasAttemptedHeadingInit,
    headingInitError,
    hasFetchCompleted,
    isHeadingFlowActive,
  ]);

  // hasAttemptedHeadingInit をリセットして再初期化を許可する。
  // (a) step5Content が null のまま init した後、後から content が入った場合
  // (b) step5Content が後から ###/#### 形式で保存し直された場合（更新検知でリセットすると
  //     fetch 一時失敗時の無限ループになるため、前回 init 時と「異なる」ときのみ）
  useEffect(() => {
    const baseGuard =
      !isHeadingFlowActive(resolvedCanvasStep) ||
      !sessionId ||
      !hasAttemptedHeadingInit ||
      headingSections.length > 0;
    if (baseGuard) return;

    const trimmedCurrent = step5Content?.trim() ?? '';
    const shouldResetForDelayedContent =
      !didInitWithStep5ContentRef.current && trimmedCurrent.length > 0;
    const shouldResetForUpdatedContent =
      trimmedCurrent &&
      !isHeadingInitInFlight &&
      trimmedCurrent !== lastInitStep5ContentRef.current &&
      extractHeadingsFromMarkdown(trimmedCurrent).length > 0;

    if (shouldResetForDelayedContent || shouldResetForUpdatedContent) {
      setHasAttemptedHeadingInit(false);
    }
  }, [
    resolvedCanvasStep,
    sessionId,
    step5Content,
    hasAttemptedHeadingInit,
    headingSections.length,
    isHeadingInitInFlight,
    isHeadingFlowActive,
  ]);

  const handleSaveHeadingSection = useCallback(
    async (content: string, overrideHeadingKey?: string): Promise<boolean> => {
      const headingKey = overrideHeadingKey ?? activeHeading?.headingKey;
      if (!sessionId || !headingKey || !isHeadingFlowActive(resolvedCanvasStep)) {
        return false;
      }
      if (!overrideHeadingKey && (activeHeadingIndex === undefined || !activeHeading)) {
        return false;
      }

      setIsSavingHeading(true);
      setHeadingSaveError(null);
      try {
        const liffAccessToken = await getAccessToken();
        if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
          const errorMessage = '認証トークンを取得できませんでした。LINEで再ログインしてください。';
          setHeadingSaveError(errorMessage);
          toast.error(errorMessage);
          return false;
        }
        const res = await headingActions.saveHeadingSection({
          sessionId,
          headingKey,
          content,
          liffAccessToken: liffAccessToken.trim(),
        });

        if (res.success) {
          const updatedSections = await fetchHeadingSections(sessionId);

          // 取得失敗時（空配列）は完了判定をスキップ
          if (updatedSections.length === 0) {
            const errorMessage = '保存結果の確認に失敗しました。再試行してください。';
            setHeadingSaveError(errorMessage);
            toast.error(errorMessage);
            return false;
          }

          // 全ての見出しが完了したかチェック（返り値を使用してステール回避）
          const allDone = updatedSections.every(s => s.isConfirmed);

          if (allDone) {
            toast.success(
              '全見出しの保存が完了しました。完成形はCanvasの全文編集時に保存されます。'
            );
          }
          return true;
        } else {
          const errorMessage = res.error || '保存に失敗しました。再試行してください。';
          setHeadingSaveError(errorMessage);
          toast.error(errorMessage);
          return false;
        }
      } catch (e) {
        console.error('Failed to save heading section:', e);
        const errorMessage =
          e instanceof Error ? e.message : '保存に失敗しました。再試行してください。';
        setHeadingSaveError(errorMessage);
        toast.error(errorMessage);
        return false;
      } finally {
        setIsSavingHeading(false);
      }
    },
    [
      sessionId,
      activeHeadingIndex,
      activeHeading,
      resolvedCanvasStep,
      fetchHeadingSections,
      getAccessToken,
      isHeadingFlowActive,
    ]
  );

  const handleRetryHeadingInit = useCallback((options?: { fromReset?: boolean }) => {
    // 明示リトライ時は初回化トラッカーも戻し、Step5 再読込後に自動初期化できるようにする。
    didInitWithStep5ContentRef.current = false;
    lastInitStep5ContentRef.current = null;
    setHeadingInitError(null);
    setHeadingSaveError(null);
    setHasAttemptedHeadingInit(false);
    if (options?.fromReset) {
      isResetInitRef.current = true;
    }
  }, []);

  const handleRebuildCombinedContent = useCallback(async (): Promise<boolean> => {
    if (!sessionId || isRebuildingCombinedContent) return false;

    setIsRebuildingCombinedContent(true);
    try {
      const liffAccessToken = await getAccessToken();
      const res = await headingActions.rebuildCombinedContentFromHeadings({
        sessionId,
        liffAccessToken,
      });

      if (!res.success) {
        const message = res.error || '完成形の再生成に失敗しました';
        toast.error(message);
        return false;
      }

      await Promise.all([fetchLatestCombinedContent(sessionId), fetchCombinedContentVersions(sessionId)]);
      setSelectedCombinedVersionId(null);
      toast.success('最新の見出し内容から完成形を作成しました');
      return true;
    } catch (error) {
      console.error('Failed to rebuild combined content:', error);
      toast.error('完成形の再生成に失敗しました');
      return false;
    } finally {
      setIsRebuildingCombinedContent(false);
    }
  }, [
    sessionId,
    isRebuildingCombinedContent,
    getAccessToken,
    fetchLatestCombinedContent,
    fetchCombinedContentVersions,
  ]);

  const selectedCombinedContent = useMemo(() => {
    if (selectedCombinedVersionId) {
      const v = combinedContentVersions.find(c => c.id === selectedCombinedVersionId);
      if (v) return v.content;
    }
    return latestCombinedContent;
  }, [combinedContentVersions, selectedCombinedVersionId, latestCombinedContent]);

  const handleCombinedVersionSelect = useCallback((versionId: string) => {
    setSelectedCombinedVersionId(versionId);
  }, []);

  /** 見出しセクションの状態を強制的に再取得する（保存・確定後の同期用） */
  const refetchHeadings = useCallback(async () => {
    if (sessionId) {
      return await fetchHeadingSections(sessionId);
    }
    return [];
  }, [sessionId, fetchHeadingSections]);

  /** 完成形のバージョン一覧と最新を再取得（Canvas編集完了後など） */
  const refetchCombinedContentVersions = useCallback(
    (targetSections?: SessionHeadingSection[]) => {
      const sectionsToCheck = targetSections || headingSections;
      if (sessionId && sectionsToCheck.length > 0 && sectionsToCheck.every(s => s.isConfirmed)) {
        void fetchLatestCombinedContent(sessionId);
        void fetchCombinedContentVersions(sessionId);
      }
    },
    [sessionId, headingSections, fetchLatestCombinedContent, fetchCombinedContentVersions]
  );

  return {
    headingSections,
    isSavingHeading,
    isHeadingInitInFlight,
    hasAttemptedHeadingInit,
    headingInitError,
    headingSaveError,
    activeHeadingIndex,
    activeHeading,
    latestCombinedContent,
    combinedContentVersions,
    selectedCombinedVersionId,
    selectedCombinedContent,
    handleCombinedVersionSelect,
    refetchCombinedContentVersions,
    handleSaveHeadingSection,
    handleRetryHeadingInit,
    handleRebuildCombinedContent,
    isRebuildingCombinedContent,
    refetchHeadings,
  };
}
