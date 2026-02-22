'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import * as headingActions from '@/server/actions/heading-flow.actions';
import type { SessionHeadingSection } from '@/types/heading-flow';
import type { BlogStepId } from '@/lib/constants';

interface UseHeadingFlowParams {
  sessionId: string | null;
  isSessionLoading: boolean;
  step5Content: string | null;
  getAccessToken: () => Promise<string>;
  resolvedCanvasStep: BlogStepId | null;
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
  fetchHeadingSections: (sessionId: string) => Promise<SessionHeadingSection[]>;
  /**
   * 見出しセクションを保存する。
   * @param content 保存するコンテンツ（canvasStreamingContent || canvasContent）
   */
  handleSaveHeadingSection: (content: string) => Promise<void>;
  handleRetryHeadingInit: () => void;
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
  // セッション切り替え直後の fetch 完了を待つフラグ。
  // false の間は初期化 effect が走らないようにブロックする。
  const [hasFetchCompleted, setHasFetchCompleted] = useState(false);

  // セッション切り替え時の競合防止用 ref
  const currentSessionIdRef = useRef(sessionId);
  useEffect(() => {
    currentSessionIdRef.current = sessionId;
  }, [sessionId]);

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
      const res = await headingActions.getHeadingSections({ sessionId: sid, liffAccessToken });
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
      const res = await headingActions.getLatestCombinedContent({
        sessionId: sid,
        liffAccessToken,
      });
      if (res.success && sid === currentSessionIdRef.current) {
        setLatestCombinedContent(res.data ?? null);
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
    setHasAttemptedHeadingInit(false);
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
          // 全確定済みの場合は結合コンテンツも取得
          if (sections.length > 0 && sections.every(s => s.isConfirmed)) {
            void fetchLatestCombinedContent(sessionId);
          }
        }
      })();
    } else {
      setHasFetchCompleted(true);
    }
  }, [sessionId, fetchHeadingSections, fetchLatestCombinedContent]);

  useEffect(() => {
    if (resolvedCanvasStep !== 'step6') {
      setHeadingSaveError(null);
    }
  }, [resolvedCanvasStep]);

  // Step 6 入場時の初期化（現在表示中のステップが step6 のとき発火）
  useEffect(() => {
    // headingSections を依存配列に含めない意図：hasFetchCompleted を介した同期により
    // セッション切り替え後の fetch 完了後に発火し、その時点の headingSections を使用する。
    if (
      !sessionId ||
      resolvedCanvasStep !== 'step6' ||
      headingSections.length > 0 ||
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
        if (step5Content) {
          const liffAccessToken = await getAccessToken();
          const res = await headingActions.initializeHeadingSections({
            sessionId,
            step5Markdown: step5Content,
            liffAccessToken,
          });
          if (res.success) {
            const sections = await fetchHeadingSections(sessionId);
            if (sections.length === 0) {
              if (sessionId === currentSessionIdRef.current) {
                setHeadingInitError('見出しの取得に失敗しました。再試行してください。');
                // hasAttemptedHeadingInit は立てず再試行可能に
              }
              // セッション切替中（sid !== currentSessionIdRef）で空配列の場合は
              // 競合防止の意図的スキップなのでエラーを立てない
            } else {
              setHeadingInitError(null);
              setHasAttemptedHeadingInit(true);
            }
          } else {
            console.error('Failed to initialize heading sections:', res.error);
            setHeadingInitError(res.error || '初期化に失敗しました');
          }
        } else {
          // step5 メッセージがない場合は「試行済み」としてループを止める
          setHasAttemptedHeadingInit(true);
        }
      } catch (e) {
        console.error('Failed to initialize heading sections:', e);
        setHeadingInitError('予期せぬエラーが発生しました');
      } finally {
        if (sessionId === currentSessionIdRef.current) {
          setIsHeadingInitInFlight(false);
        }
      }
    };

    void initAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- headingSections は意図的に除外。hasFetchCompleted による同期設計。
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
  ]);

  const handleSaveHeadingSection = useCallback(
    async (content: string) => {
      if (
        !sessionId ||
        activeHeadingIndex === undefined ||
        !activeHeading ||
        resolvedCanvasStep !== 'step6'
      ) {
        return;
      }

      setIsSavingHeading(true);
      setHeadingSaveError(null);
      try {
        const liffAccessToken = await getAccessToken();
        const res = await headingActions.saveHeadingSection({
          sessionId,
          headingKey: activeHeading.headingKey,
          content,
          liffAccessToken,
        });

        if (res.success) {
          const updatedSections = await fetchHeadingSections(sessionId);

          // 取得失敗時（空配列）は完了判定をスキップ
          if (updatedSections.length === 0) {
            const errorMessage = '保存結果の確認に失敗しました。再試行してください。';
            setHeadingSaveError(errorMessage);
            toast.error(errorMessage);
            return;
          }

          // 全ての見出しが完了したかチェック（返り値を使用してステール回避）
          const allDone = updatedSections.every(s => s.isConfirmed);

          if (allDone) {
            void fetchLatestCombinedContent(sessionId);
            toast.success(
              '全見出しの保存が完了しました。全体の構成を確認して本文作成（Step 7）に進んでください。'
            );
          }
        } else {
          const errorMessage = res.error || '保存に失敗しました。再試行してください。';
          setHeadingSaveError(errorMessage);
          toast.error(errorMessage);
          return;
        }
      } catch (e) {
        console.error('Failed to save heading section:', e);
        const errorMessage = e instanceof Error ? e.message : '保存に失敗しました。再試行してください。';
        setHeadingSaveError(errorMessage);
        toast.error(errorMessage);
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
      fetchLatestCombinedContent,
      getAccessToken,
    ]
  );

  const handleRetryHeadingInit = useCallback(() => {
    setHeadingInitError(null);
    setHeadingSaveError(null);
    setHasAttemptedHeadingInit(false);
  }, []);

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
    fetchHeadingSections,
    handleSaveHeadingSection,
    handleRetryHeadingInit,
  };
}
