import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { ChatMessage } from '@/domain/interfaces/IChatService';
import { useCanvasVersions } from '@/hooks/useCanvasVersions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import type { BlogStepId } from '@/lib/constants';
import { FIRST_BLOG_STEP_ID, STEP7_ID } from '@/lib/constants';
import { createFullMarkdownDecoder } from '@/lib/markdown-decoder';
import { getSaveModelForCanvasStep } from '@/lib/canvas-content';
import { resolveHeadingCanvasViewMode } from '@/lib/canvas-mode';
import {
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import type { ChatLayoutProps } from '@/types/chat-layout';
import type { CanvasSelectionEditPayload, CanvasSelectionEditResult } from '@/types/canvas';
import type { SessionHeadingSection } from '@/types/heading-flow';
import type { StepActionBarRef } from '@/../app/chat/components/StepActionBar';
import type { AnnotationRecord } from '@/types/annotation';
import { useBlogFlowControls } from '@/hooks/useBlogFlowControls';

const CANVAS_ANTHROPIC_RETRY_TOAST_ID = 'canvas-anthropic-retry';

interface UseCanvasSelectionEditStreamParams {
  canvasEditInFlightRef: RefObject<boolean>;
  setIsCanvasStreaming: Dispatch<SetStateAction<boolean>>;
  resolvedCanvasStep: BlogStepId | null;
  stepActionBarRef: RefObject<StepActionBarRef | null>;
  latestBlogStep: BlogStepId | null;
  headingSections: SessionHeadingSection[];
  viewingHeadingIndex: number | null;
  activeHeadingIndex: number | undefined;
  isViewingPastHeadingContent: boolean;
  isViewingCombinedContent: boolean;
  chatSession: ChatLayoutProps['chatSession'];
  setCanvasStreamingContent: Dispatch<SetStateAction<string>>;
  setOptimisticMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  annotationOpen: boolean;
  setAnnotationOpen: Dispatch<SetStateAction<boolean>>;
  setAnnotationData: Dispatch<SetStateAction<AnnotationRecord | null>>;
  setCanvasStep: Dispatch<SetStateAction<BlogStepId | null>>;
  setSelectedVersionByStep: ReturnType<typeof useCanvasVersions>['setSelectedVersionByStep'];
  setFollowLatestByStep: ReturnType<typeof useCanvasVersions>['setFollowLatestByStep'];
  setCanvasPanelOpen: Dispatch<SetStateAction<boolean>>;
  canvasEditHistory: { role: 'user' | 'assistant'; content: string }[];
  setCanvasEditHistory: Dispatch<
    SetStateAction<{ role: 'user' | 'assistant'; content: string }[]>
  >;
  handleModelChange: ReturnType<typeof useBlogFlowControls>['handleModelChange'];
  refetchCombinedContentVersions: ReturnType<
    typeof useHeadingFlow
  >['refetchCombinedContentVersions'];
}

export function useCanvasSelectionEditStream({
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
}: UseCanvasSelectionEditStreamParams) {
  const handleCanvasSelectionEdit = useCallback(
    async (payload: CanvasSelectionEditPayload): Promise<CanvasSelectionEditResult> => {
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
        const contentStep = payload.contentStep;
        const step7ViewModeForRequest = resolveHeadingCanvasViewMode({
          step: targetStep,
          headingCount: headingSections.length,
          viewingHeadingIndex,
          activeHeadingIndex,
          ignoreActiveHeadingIndex: isViewingPastHeadingContent || isViewingCombinedContent,
        });
        const headingContextIndex = step7ViewModeForRequest.headingIndex;
        // getSaveModelForCanvasStep: BlogPreviewTile の stepLabel と Canvas のステップを一致させるため。
        const canvasModel = getSaveModelForCanvasStep(targetStep, headingContextIndex);

        // canvasContentの検証
        if (!payload.canvasContent || payload.canvasContent.trim() === '') {
          throw new Error('キャンバスコンテンツが空です。編集対象が見つかりませんでした。');
        }

        // セッションIDの検証
        if (!chatSession.state.currentSessionId) {
          throw new Error('セッションIDが見つかりません');
        }

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

        let markdownDecoder = createFullMarkdownDecoder();

        // ✅ ストリーミングAPI呼び出し（必要に応じてWeb検索を利用）
        // 見出し単位 = 未確定の見出し編集中 OR 確定済み見出しの再編集（戻るで遷移）。完成形表示時は false
        const isHeadingUnit = step7ViewModeForRequest.isHeadingUnit;
        const response = await fetch('/api/chat/canvas/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: chatSession.state.currentSessionId,
            instruction,
            selectedText,
            canvasContent: payload.canvasContent,
            contentStep,
            targetStep,
            enableWebSearch: shouldEnableWebSearch,
            ...(isHeadingUnit && { isHeadingUnit: true }),
            ...(headingContextIndex !== null && { step7HeadingIndex: headingContextIndex }),
            webSearchConfig: {
              maxUses: 3,
            },
            ...(freeFormUserPrompt !== undefined && { freeFormUserPrompt }),
            canvasHistory: canvasEditHistory.slice(-4),
          }),
        });

        if (response.status === 409) {
          setOptimisticMessages([]);
          replaceToEmailLinkConflictLogin();
          return { replacementHtml: '' };
        }

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `ストリーミングAPIエラー: ${response.status}`;
          const sseErrorMatch = errorText.match(/event:\s*error[\s\S]*?data:\s*(\{.*\})/);

          if (sseErrorMatch?.[1]) {
            try {
              const parsed = JSON.parse(sseErrorMatch[1]) as { message?: string };
              if (parsed.message?.trim()) {
                errorMessage = parsed.message.trim();
              }
            } catch (parseError) {
              console.warn('Canvas error response parse failed:', parseError);
            }
          }

          throw new Error(errorMessage);
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

          if (eventType === 'retry' && typeof eventData === 'object' && eventData !== null) {
            const message =
              (eventData as { message?: string }).message ??
              'AIサーバーが混雑しています。自動で再試行しています...';
            toast.loading(message, { id: CANVAS_ANTHROPIC_RETRY_TOAST_ID });
            fullMarkdown = '';
            analysisResult = '';
            markdownDecoder = createFullMarkdownDecoder();
            setCanvasStreamingContent('');
            setOptimisticMessages(prev =>
              prev.map(msg => {
                if (msg.id === tempAssistantCanvasId || msg.id === tempAssistantAnalysisId) {
                  return { ...msg, content: '' };
                }
                return msg;
              })
            );
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
            toast.dismiss(CANVAS_ANTHROPIC_RETRY_TOAST_ID);
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
            toast.dismiss(CANVAS_ANTHROPIC_RETRY_TOAST_ID);
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

        setCanvasEditHistory(prev => [
          ...prev,
          { role: 'user' as const, content: instruction },
          { role: 'assistant' as const, content: analysisResult || '編集を適用しました' },
        ]);

        handleModelChange('blog_creation', targetStep);

        // セッションを再読み込みして最新メッセージを取得
        await chatSession.actions.loadSession(chatSession.state.currentSessionId);

        // Step6 完成形の Canvas 編集時は session_combined_contents に新バージョンが保存されているため再取得
        if (
          targetStep === STEP7_ID &&
          headingSections.length > 0 &&
          headingSections.every(s => s.isConfirmed)
        ) {
          await refetchCombinedContentVersions({ force: true });
        }

        // 楽観的更新をクリア（実際のメッセージで置き換え）
        setOptimisticMessages([]);

        // 通常のブログ作成と同じように、新しいメッセージがチャットに表示される
        // ユーザーはBlogPreviewTileをクリックしてCanvasを開く
        return { replacementHtml: '' };
      } catch (error) {
        console.error('Canvas selection edit failed:', error);
        toast.dismiss(CANVAS_ANTHROPIC_RETRY_TOAST_ID);
        setOptimisticMessages([]);
        throw error instanceof Error ? error : new Error('AI編集の処理に失敗しました');
      } finally {
        toast.dismiss(CANVAS_ANTHROPIC_RETRY_TOAST_ID);
        canvasEditInFlightRef.current = false;
        // 成功/失敗問わずクリア必須。残すと Step7 見出し切り替え時に旧ストリーミング本文が
        // 別見出しの「現在コンテンツ」として扱われ、誤保存を誘発する（P1）。
        // loadSession/refetch は await 済みのため、state 反映後にクリアして巻き戻りを防ぐ。
        setCanvasStreamingContent('');
        setIsCanvasStreaming(false);
      }
    },
    [
      activeHeadingIndex,
      annotationOpen,
      canvasEditHistory,
      chatSession.actions,
      chatSession.state.currentSessionId,
      handleModelChange,
      headingSections,
      isViewingCombinedContent,
      isViewingPastHeadingContent,
      latestBlogStep,
      refetchCombinedContentVersions,
      resolvedCanvasStep,
      viewingHeadingIndex,
      setAnnotationData,
      setAnnotationOpen,
      setCanvasPanelOpen,
      setCanvasEditHistory,
      setCanvasStep,
      setFollowLatestByStep,
      setOptimisticMessages,
      setCanvasStreamingContent,
      setSelectedVersionByStep,
      canvasEditInFlightRef,
      stepActionBarRef,
      setIsCanvasStreaming,
    ]
  );
  return { handleCanvasSelectionEdit };
}
