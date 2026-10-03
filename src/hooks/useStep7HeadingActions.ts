import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useBlogFlowControls } from '@/hooks/useBlogFlowControls';
import type { ChatLayoutProps } from '@/types/chat-layout';
import type { BlogStepId } from '@/lib/constants';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { getStep7HeadingModel, STEP7_ID, toBlogModel } from '@/lib/constants';
import type { BlogCanvasVersion } from '@/types/chat-layout';
import { formatMarkdownHeading, normalizeHeadingUnitContent } from '@/lib/heading-extractor';
import {
  getCombinedContentForStep7,
  saveCombinedContentForStep7,
} from '@/server/actions/heading-flow.actions';

interface UseStep7HeadingActionsParams {
  chatSession: ChatLayoutProps['chatSession'];
  viewingHeadingIndex: number | null;
  headingSections: SessionHeadingSection[];
  activeHeadingIndex: number | undefined;
  activeHeading: SessionHeadingSection | undefined;
  isStep6ContentStale: boolean;
  setIsStep6ContentStale: Dispatch<SetStateAction<boolean>>;
  canvasPanelOpen: boolean;
  effectiveViewingHeadingIndex: number | null;
  canvasContentRef: RefObject<string>;
  canvasStreamingContent: string;
  canvasContent: string;
  getLatestStep7HeadingContent: (
    messages: ChatMessage[],
    headingIndex: number,
    minTimestamp?: number
  ) => string | null;
  allMessagesForVersions: ChatMessage[];
  hasContentForActiveHeading: boolean;
  handleSaveHeadingSectionFromFlow: ReturnType<typeof useHeadingFlow>['handleSaveHeadingSection'];
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  saveHeadingInFlightRef: RefObject<boolean>;
  buildCombinedInFlightRef: RefObject<boolean>;
  setIsBuildingCombined: Dispatch<SetStateAction<boolean>>;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  resetCombinedVersionToLatest: ReturnType<typeof useHeadingFlow>['resetCombinedVersionToLatest'];
  setSelectedVersionByStep: ReturnType<typeof useCanvasVersions>['setSelectedVersionByStep'];
  refetchCombinedContentVersions: ReturnType<typeof useHeadingFlow>['refetchCombinedContentVersions'];
  openCombinedCanvasRef: RefObject<(versionId?: string) => void>;
  pendingAutoOpenHeadingRef: RefObject<boolean>;
  handleSendMessage: ReturnType<typeof useBlogFlowControls>['handleSendMessage'];
}

export function useStep7HeadingActions({
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
}: UseStep7HeadingActionsParams) {
  // handleSaveHeadingSection はフック側のシグネチャが (content: string, overrideHeadingKey?: string) のため、ここでラップする。
  // CanvasPanel が contentRef に表示中の内容を随時更新するため、保存時は ref を優先して
  // ストリーミング完了直後のクリックでも最新編集内容が保存される。
  // 見出し+本文で表示されている場合、保存時は見出し行を除去して本文のみを渡す（結合時に heading_text を自動付与するため二重化防止）
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
      if (hasContentForActiveHeading) {
        // コンテンツは存在すると判定されているが取得に失敗。再試行を促し、見出し生成への切り替えは行わない（編集上書き防止）
        toast.error(
          '保存に失敗しました。Canvasの内容を確認し、タイルをクリックして再読み込みしてから保存を再試行してください。'
        );
      } else {
        setIsStep6ContentStale(true);
        toast.error(
          '最後の見出しの本文が見つかりません。Canvas に表示されている内容を確認し、見出し生成をもう一度実行してください。'
        );
      }
      return;
    }
    const contentToSave =
      section && rawContent
        ? normalizeHeadingUnitContent(
            rawContent,
            section.headingText,
            headingSections.slice(activeHeadingIndex + 1).map(s => s.headingText)
          )
        : rawContent;

    if (!contentToSave?.trim()) {
      saveHeadingInFlightRef.current = false;
      if (hasContentForActiveHeading) {
        toast.error(
          '保存する本文が空です。見出し行以外の本文を入力するか、タイルをクリックして再読み込みしてから保存を再試行してください。'
        );
      } else {
        setIsStep6ContentStale(true);
        toast.error(
          '最後の見出しの本文が見つかりません。Canvas に表示されている内容を確認し、見出し生成をもう一度実行してください。'
        );
      }
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
    hasContentForActiveHeading,
    canvasContentRef,
    saveHeadingInFlightRef,
    setCanvasStreamingContent,
    setIsStep6ContentStale,
  ]);

  /** 全見出し保存後: 書き出し＋各見出し本文を結合して完成形として保存 */
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
      // '' は Email ユーザーの有効トークン。Server Action 側が Email セッションで解決する
      const res = await getCombinedContentForStep7({
        sessionId: chatSession.state.currentSessionId,
      });
      if (!res.success || res.sections == null) {
        toast.error(
          res.error ?? '完成形の構築に失敗しました。書き出し案の入力をもう一度お試しください。'
        );
        return;
      }
      if (!res.sections.trim()) {
        toast.error('結合する見出し本文がありません。各見出しを保存してからもう一度お試しください。');
        return;
      }

      const saveRes = await saveCombinedContentForStep7({
        sessionId: chatSession.state.currentSessionId,
      });
      if (!saveRes.success) {
        toast.error(saveRes.error ?? '完成形の保存に失敗しました。');
        return;
      }

      setSelectedModel('blog_creation');
      setCanvasStreamingContent(saveRes.content ?? '');
      resetCombinedVersionToLatest();
      setSelectedVersionByStep(prev => ({
        ...prev,
        [STEP7_ID]: null,
      }));
      await refetchCombinedContentVersions({ force: true });
      toast.success('完成形を結合して保存しました');
      openCombinedCanvasRef.current();
    } catch (error) {
      console.error('Failed to build combined content:', error);
      toast.error(
        error instanceof Error ? error.message : '完成形の構築に失敗しました。しばらく経ってからもう一度お試しください。'
      );
    } finally {
      buildCombinedInFlightRef.current = false;
      setIsBuildingCombined(false);
    }
  }, [
    chatSession.state.currentSessionId,
    resetCombinedVersionToLatest,
    refetchCombinedContentVersions,
    setSelectedVersionByStep,
    buildCombinedInFlightRef,
    openCombinedCanvasRef,
    setCanvasStreamingContent,
    setIsBuildingCombined,
    setSelectedModel,
  ]);

  // ✅ 見出し単位生成: スタート/この見出しを生成ボタンでチャット送信の代わりに生成開始。
  // headingIndex を model に含めることで、タイルクリック時に該当見出しを正しく開けるようにする。
  const handleStartHeadingGeneration = useCallback(
    (headingIndex: number) => {
      pendingAutoOpenHeadingRef.current = true;
      setSelectedModel('blog_creation');
      const model =
        Number.isInteger(headingIndex) && headingIndex >= 0
          ? getStep7HeadingModel(headingIndex)
          : toBlogModel(STEP7_ID);
      const headingText =
        Number.isInteger(headingIndex) && headingIndex >= 0
          ? headingSections[headingIndex]?.headingText?.trim() ?? ''
          : '';
      const userMessage = headingText
        ? `「${headingText}」の本文を書いてください`
        : 'この見出しの本文を書いてください';
      console.warn('[Step7] Start heading generation', {
        headingIndex,
        model,
        headingText: headingText || null,
      });
      void handleSendMessage(userMessage, model);
    },
    [handleSendMessage, headingSections, pendingAutoOpenHeadingRef, setSelectedModel]
  );

  return { viewingSection, handleSaveHeadingClick, handleBuildCombinedOnly, handleStartHeadingGeneration };
}
