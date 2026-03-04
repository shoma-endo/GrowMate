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
  getAccessToken: () => Promise<string>;
  resolvedCanvasStep: BlogStepId | null;
}

/** 完成形の1バージョン（session_combined_contents 由来） */
export interface CombinedContentVersion {
  id: string;
  versionNo: number;
  content: string;
  isLatest: boolean;
  /** 時系列表示用。ISO 文字列 */
  createdAt?: string;
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
  /** 選択を最新表示に戻す（完成形保存後など） */
  resetCombinedVersionToLatest: () => void;
  /** 完成形のバージョン一覧と最新を再取得（Canvas編集完了後など）
   * @param arg targetSections or { force: true }（本文生成直後は force でセクション確認スキップ）
   */
  refetchCombinedContentVersions: (
    arg?: SessionHeadingSection[] | { force?: boolean }
  ) => Promise<void>;
  /**
   * 見出しセクションを保存する。
   * @param content 保存するコンテンツ（canvasStreamingContent || canvasContent）
   * @param overrideHeadingKey 指定時はその見出しを保存（再編集用）。未指定時は activeHeading を保存
   */
  handleSaveHeadingSection: (content: string, overrideHeadingKey?: string) => Promise<boolean>;
  handleRetryHeadingInit: (options?: { fromReset?: boolean }) => void;
  /** 見出しセクションの状態を強制的に再取得する（保存・確定後の同期用） */
  refetchHeadings: () => Promise<SessionHeadingSection[]>;
}

/** 基本構成未入力時に表示。CanvasPanel 等でラベル切り替えに利用 */
export const BASIC_STRUCTURE_REQUIRED_MESSAGE =
  'メモ・補足情報の「基本構成」に、### と #### 形式で見出しを入力して保存してください。';

export function useHeadingFlow({
  sessionId,
  isSessionLoading,
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
          // Step7 フロー中（見出しあり）は結合コンテンツを取得。再開後・リロード後も完成形タイルを表示するため全確定に限定しない
          if (sections.length > 0) {
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
        // 見出し抽出元: メモ・補足情報の「基本構成」（content_annotations.basic_structure）のみ。
        // step5 チャットは使用しない。basic_structure の初期化（書き込み）は行わない。
        const annotationRes = await getContentAnnotationBySession(sessionId);
        if (!annotationRes.success) {
          if (sessionId === currentSessionIdRef.current) {
            setHeadingInitError(
              annotationRes.error || 'メモ・補足情報の取得に失敗しました。再試行してください。'
            );
            setHasAttemptedHeadingInit(true);
          }
          return;
        }
        const trimmedBasic = annotationRes.data?.basic_structure?.trim() ?? '';
        const headings = trimmedBasic
          ? extractHeadingsFromMarkdown(trimmedBasic)
          : [];

        if (headings.length > 0) {
          const liffAccessToken = await getAccessToken();
          if (!liffAccessToken || typeof liffAccessToken !== 'string' || !liffAccessToken.trim()) {
            if (sessionId === currentSessionIdRef.current) {
              setHeadingInitError('認証トークンを取得できませんでした。LINEで再ログインしてください。');
            }
            return;
          }
          const res = await headingActions.initializeHeadingSections({
            sessionId,
            step5Markdown: trimmedBasic,
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
          // 基本構成が空、または ###/#### 見出しが抽出できない場合は導線を表示
          if (sessionId === currentSessionIdRef.current) {
            setHeadingInitError(BASIC_STRUCTURE_REQUIRED_MESSAGE);
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
    isSessionLoading,
    fetchHeadingSections,
    getAccessToken,
    hasAttemptedHeadingInit,
    headingInitError,
    hasFetchCompleted,
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
            toast.success('全見出しの保存が完了しました。');
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
    setHeadingInitError(null);
    setHeadingSaveError(null);
    setHasAttemptedHeadingInit(false);
    if (options?.fromReset) {
      isResetInitRef.current = true;
    }
  }, []);

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

  const resetCombinedVersionToLatest = useCallback(() => {
    setSelectedCombinedVersionId(null);
  }, []);

  /** 見出しセクションの状態を強制的に再取得する（保存・確定後の同期用） */
  const refetchHeadings = useCallback(async () => {
    if (sessionId) {
      return await fetchHeadingSections(sessionId);
    }
    return [];
  }, [sessionId, fetchHeadingSections]);

  /** 完成形のバージョン一覧と最新を再取得（Canvas編集完了後など）
   * @param arg targetSections or { force: true }（本文生成直後は force でセクション確認スキップ）
   */
  const refetchCombinedContentVersions = useCallback(
    async (arg?: SessionHeadingSection[] | { force?: boolean }) => {
      const force = typeof arg === 'object' && arg !== null && !Array.isArray(arg) && arg.force === true;
      const sections = Array.isArray(arg) ? arg : headingSections;
      const canFetch =
        sessionId &&
        (force || (sections.length > 0 && sections.every(s => s.isConfirmed)));
      if (canFetch) {
        await Promise.all([
          fetchLatestCombinedContent(sessionId),
          fetchCombinedContentVersions(sessionId),
        ]);
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
    resetCombinedVersionToLatest,
    refetchCombinedContentVersions,
    handleSaveHeadingSection,
    handleRetryHeadingInit,
    refetchHeadings,
  };
}
