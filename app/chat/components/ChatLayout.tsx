'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChatSessionHook } from '@/hooks/useChatSession';
import { SubscriptionHook } from '@/hooks/useSubscriptionStatus';
import { useServiceSelection } from '@/hooks/useServiceSelection';
import { useLiffContext } from '@/components/LiffProvider';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  extractBlogStepFromModel,
  findLatestAssistantBlogStep,
  normalizeCanvasContent,
  isBlogStepId,
} from '@/lib/canvas-content';
import SessionSidebar from './SessionSidebar';
import MessageArea from './MessageArea';
import InputArea from './InputArea';
import CanvasPanel from './CanvasPanel';
import type { CanvasSelectionEditPayload, CanvasSelectionEditResult } from '@/types/canvas';
import AnnotationPanel from './AnnotationPanel';
import type { StepActionBarRef } from './StepActionBar';
import { getContentAnnotationBySession } from '@/server/actions/wordpress.actions';
import { getLatestBlogStep7MessageBySession } from '@/server/actions/chat.actions';
import { useHeadingFlow } from '@/hooks/useHeadingFlow';
import { Service } from '@/server/schemas/brief.schema';
import { BlogStepId, BLOG_STEP_IDS } from '@/lib/constants';
import type { AnnotationRecord } from '@/types/annotation';
import { ViewModeBanner } from '@/components/ViewModeBanner';

const FULL_MARKDOWN_PREFIX = '"full_markdown":"';
const TITLE_META_SYSTEM_PROMPT =
  '本文を元にタイトル（全角32文字以内で狙うキーワードはなるべく左よせ）、説明文（全角80文字程度）を３パターン作成してください';

interface FullMarkdownDecoder {
  feed: (chunk: string) => string;
  reset: () => void;
}

const createFullMarkdownDecoder = (): FullMarkdownDecoder => {
  const prefix = FULL_MARKDOWN_PREFIX;
  let prefixIndex = 0;
  let capturing = false;
  let escapeNext = false;
  let unicodeRemaining = 0;
  let unicodeBuffer = '';
  let result = '';

  const feed = (chunk: string) => {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i]!;

      if (!capturing) {
        if (char === prefix[prefixIndex]!) {
          prefixIndex += 1;
          if (prefixIndex === prefix.length) {
            capturing = true;
            prefixIndex = 0;
          }
        } else {
          prefixIndex = char === prefix[0] ? 1 : 0;
        }
        continue;
      }

      if (unicodeRemaining > 0) {
        if (/[0-9a-fA-F]/.test(char)) {
          unicodeBuffer += char;
          unicodeRemaining -= 1;
          if (unicodeRemaining === 0) {
            const codePoint = Number.parseInt(unicodeBuffer, 16);
            if (!Number.isNaN(codePoint)) {
              result += String.fromCodePoint(codePoint);
            }
            unicodeBuffer = '';
          }
        } else {
          unicodeRemaining = 0;
          unicodeBuffer = '';
          if (char === '"') {
            capturing = false;
          }
        }
        continue;
      }

      if (escapeNext) {
        switch (char) {
          case '\\':
            result += '\\';
            break;
          case '"':
            result += '"';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u':
            unicodeRemaining = 4;
            unicodeBuffer = '';
            break;
          default:
            result += char;
            break;
        }
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        capturing = false;
        continue;
      }

      result += char;
    }

    return result;
  };

  const reset = () => {
    prefixIndex = 0;
    capturing = false;
    escapeNext = false;
    unicodeRemaining = 0;
    unicodeBuffer = '';
    result = '';
  };

  return { feed, reset };
};

interface ChatLayoutProps {
  chatSession: ChatSessionHook;
  subscription: SubscriptionHook;
  isMobile?: boolean;
  initialStep?: BlogStepId | null;
}

const ErrorAlert: React.FC<{ error: string; onClose?: () => void }> = ({ error, onClose }) => (
  <div className="bg-red-50 border-l-4 border-red-400 p-4 m-3" role="alert" aria-live="polite">
    <div className="flex">
      <div className="flex-shrink-0">
        <AlertCircle className="h-5 w-5 text-red-400" />
      </div>
      <div className="ml-3 flex-1 break-words">
        <p className="text-sm text-red-700 break-words">{error}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="text-sm text-red-600 ml-4 hover:text-red-800 focus-visible:ring-2 focus-visible:ring-red-300 rounded"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  </div>
);

const WarningAlert: React.FC<{ message: string; onClose?: () => void }> = ({
  message,
  onClose,
}) => (
  <div
    className="bg-yellow-50 border-l-4 border-yellow-400 p-4 m-3"
    role="status"
    aria-live="polite"
  >
    <div className="flex">
      <div className="flex-shrink-0">
        <AlertTriangle className="h-5 w-5 text-yellow-500" />
      </div>
      <div className="ml-3 flex-1 break-words">
        <p className="text-sm text-yellow-800 break-words">{message}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="text-sm text-yellow-700 ml-4 hover:text-yellow-900 focus-visible:ring-2 focus-visible:ring-yellow-300 rounded"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  </div>
);

interface BlogCanvasVersion {
  id: string;
  content: string;
  raw: string;
  step: BlogStepId;
  model?: string;
  createdAt: number;
}

type StepVersionsMap = Record<BlogStepId, BlogCanvasVersion[]>;

// 自動開始は行わず、明示ボタンで開始する
interface ChatLayoutCtx {
  chatSession: ChatSessionHook;
  subscription: SubscriptionHook;
  isMobile: boolean;
  blogFlowActive: boolean;
  optimisticMessages: ChatMessage[];
  isCanvasStreaming: boolean;
  selectedModel: string;
  latestBlogStep: BlogStepId | null;
  stepActionBarRef: React.RefObject<StepActionBarRef | null>;
  ui: {
    sidebar: { open: boolean; setOpen: (open: boolean) => void };
    canvas: { open: boolean; show: (message: ChatMessage) => void };
    annotation: {
      open: boolean;
      loading: boolean;
      data: AnnotationRecord | null;
      openWith: () => void;
      setOpen: (open: boolean) => void;
    };
  };
  onSendMessage: (content: string, model: string) => Promise<void>;
  handleModelChange: (model: string, step?: BlogStepId) => void;
  nextStepForPlaceholder: BlogStepId | null;
  currentSessionTitle: string;
  isEditingSessionTitle: boolean;
  draftSessionTitle: string;
  sessionTitleError: string | null;
  isSavingSessionTitle: boolean;
  onSessionTitleEditStart: () => void;
  onSessionTitleEditChange: (value: string) => void;
  onSessionTitleEditCancel: () => void;
  onSessionTitleEditConfirm: () => void;
  onNextStepChange: (nextStep: BlogStepId | null) => void;
  hasStep7Content: boolean;
  onGenerateTitleMeta: () => void;
  isGenerateTitleMetaLoading: boolean;
  onLoadBlogArticle?: (() => Promise<void>) | null | undefined;
  headingIndex?: number;
  totalHeadings: number;
  currentHeadingText?: string;
  initialStep?: BlogStepId | null;
  services: Service[];
  selectedServiceId: string | null;
  onServiceChange: (serviceId: string) => void;
  servicesError: string | null;
  onDismissServicesError: () => void;
}

const ChatLayoutContent: React.FC<{ ctx: ChatLayoutCtx }> = ({ ctx }) => {
  const {
    chatSession,
    subscription,
    isMobile,
    blogFlowActive,
    optimisticMessages,
    isCanvasStreaming,
    selectedModel,
    latestBlogStep,
    stepActionBarRef,
    ui,
    onSendMessage,
    handleModelChange,
    nextStepForPlaceholder,
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
    headingIndex,
    totalHeadings,
    currentHeadingText,
    initialStep,
    services,
    selectedServiceId,
    onServiceChange,
    servicesError,
    onDismissServicesError,
  } = ctx;
  const { isOwnerViewMode } = useLiffContext();
  const [manualBlogStep, setManualBlogStep] = useState<BlogStepId | null>(null);

  const currentStep: BlogStepId = BLOG_STEP_IDS[0] as BlogStepId;
  const flowStatus: 'idle' | 'running' | 'waitingAction' | 'error' = 'idle';
  const normalizedInitialStep =
    initialStep && BLOG_STEP_IDS.includes(initialStep) ? initialStep : null;
  // 最新メッセージのステップを優先し、なければ初期ステップにフォールバック
  const detectedStep = latestBlogStep ?? normalizedInitialStep ?? currentStep;
  const displayStep = manualBlogStep ?? detectedStep;
  const hasDetectedBlogStep =
    latestBlogStep !== null ||
    (normalizedInitialStep !== null && normalizedInitialStep !== BLOG_STEP_IDS[0]);
  const displayIndex = useMemo(() => {
    const index = BLOG_STEP_IDS.indexOf(displayStep);
    return index >= 0 ? index : 0;
  }, [displayStep]);
  const shouldShowLoadButton = displayStep === 'step7';
  useEffect(() => {
    setManualBlogStep(null);
  }, [chatSession.state.currentSessionId]);

  useEffect(() => {
    if (!manualBlogStep) {
      return;
    }
    if (manualBlogStep === detectedStep) {
      setManualBlogStep(null);
    }
  }, [manualBlogStep, detectedStep]);
  const handleManualStepChange = useCallback((targetStep: BlogStepId) => {
    setManualBlogStep(targetStep);
  }, []);

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

  const shouldShowStepActionBar = blogFlowActive && !chatSession.state.isLoading;

  const isReadOnly = isOwnerViewMode;

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
            <ErrorAlert
              error={subscription.error}
              onClose={() => setIsSubscriptionErrorDismissed(true)}
            />
          )}

        {chatSession.state.error && !isErrorDismissed && (
          <ErrorAlert error={chatSession.state.error} onClose={() => setIsErrorDismissed(true)} />
        )}

        {chatSession.state.warning && !isWarningDismissed && (
          <WarningAlert
            message={chatSession.state.warning}
            onClose={() => setIsWarningDismissed(true)}
          />
        )}

        {servicesError && <WarningAlert message={servicesError} onClose={onDismissServicesError} />}

        <MessageArea
          messages={[...chatSession.state.messages, ...optimisticMessages]}
          isLoading={chatSession.state.isLoading || isCanvasStreaming}
          blogFlowActive={blogFlowActive}
          onOpenCanvas={message => ui.canvas.show(message)}
        />

        <InputArea
          onSendMessage={onSendMessage}
          disabled={chatSession.state.isLoading || ui.annotation.loading || isReadOnly}
          shouldShowStepActionBar={shouldShowStepActionBar}
          stepActionBarRef={stepActionBarRef}
          displayStep={displayStep}
          hasDetectedBlogStep={hasDetectedBlogStep}
          onSaveClick={() => ui.annotation.openWith()}
          annotationLoading={ui.annotation.loading}
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
          nextStepForPlaceholder={nextStepForPlaceholder}
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
          totalHeadings={totalHeadings}
          {...(headingIndex !== undefined && { headingIndex })}
          {...(currentHeadingText !== undefined && { currentHeadingText })}
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
          onSaveSuccess={() => {}}
          isVisible={ui.annotation.open}
        />
      )}
    </>
  );
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
  const [annotationData, setAnnotationData] = useState<AnnotationRecord | null>(null);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [isGeneratingTitleMeta, setIsGeneratingTitleMeta] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [canvasStep, setCanvasStep] = useState<BlogStepId | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedVersionByStep, setSelectedVersionByStep] = useState<
    Partial<Record<BlogStepId, string | null>>
  >({});
  const [followLatestByStep, setFollowLatestByStep] = useState<
    Partial<Record<BlogStepId, boolean>>
  >({});
  const [nextStepForPlaceholder, setNextStepForPlaceholder] = useState<BlogStepId | null>(null);
  const [canvasStreamingContent, setCanvasStreamingContent] = useState<string>('');
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [isCanvasStreaming, setIsCanvasStreaming] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const latestBlogStep = useMemo(
    () => findLatestAssistantBlogStep(chatSession.state.messages ?? []),
    [chatSession.state.messages]
  );
  const currentSession = useMemo(
    () =>
      chatSession.state.sessions.find(
        session => session.id === chatSession.state.currentSessionId
      ) || null,
    [chatSession.state.sessions, chatSession.state.currentSessionId]
  );
  const currentSessionTitle = currentSession?.title ?? '新しいチャット';
  const canvasEditInFlightRef = useRef(false);
  const prevSessionIdRef = useRef<string | null>(null);
  const canvasContentRef = useRef<string>('');

  useEffect(() => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId) {
      return;
    }

    let isActive = true;

    const loadAnnotations = async () => {
      try {
        const res = await getContentAnnotationBySession(sessionId);
        if (!isActive) return;

        if (res.success && res.data) {
          setAnnotationData(res.data);
        } else {
          setAnnotationData(null);
        }
      } catch (error) {
        console.error('Failed to preload annotation data:', error);
      }
    };

    loadAnnotations();

    return () => {
      isActive = false;
    };
  }, [chatSession.state.currentSessionId]);

  const handleLoadBlogArticle = useCallback(async () => {
    if (!chatSession.state.currentSessionId) {
      throw new Error('セッションが選択されていません');
    }
    const sessionId = chatSession.state.currentSessionId;
    try {
      const annotationRes = await getContentAnnotationBySession(sessionId);
      if (!annotationRes.success) {
        throw new Error(annotationRes.error || 'ブログ記事情報の取得に失敗しました');
      }

      const latestAnnotation = annotationRes.data ?? null;
      setAnnotationData(latestAnnotation);

      const canonicalUrl = latestAnnotation?.canonical_url?.trim() ?? '';
      if (!canonicalUrl) {
        throw new Error('ブログ記事URLが登録されていません');
      }

      const accessToken = await getAccessToken();
      const response = await fetch('/api/chat/canvas/load-wordpress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ sessionId }),
        credentials: 'include',
      });

      const responseData: { success?: boolean; error?: string } | null = await response
        .json()
        .catch(() => null);

      if (!response.ok || !responseData?.success) {
        const message =
          (responseData && typeof responseData.error === 'string' && responseData.error.length > 0
            ? responseData.error
            : null) ?? 'WordPress記事の取得に失敗しました';
        throw new Error(message);
      }

      await chatSession.actions.loadSession(sessionId);
      setFollowLatestByStep(prev => ({
        ...prev,
        step7: true,
      }));
      setSelectedVersionByStep(prev => ({
        ...prev,
        step7: null,
      }));
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('WordPress記事の取得に失敗しました');
    }
  }, [chatSession.actions, chatSession.state.currentSessionId, getAccessToken]);

  const blogCanvasVersionsByStep = useMemo<StepVersionsMap>(() => {
    const initialMap = BLOG_STEP_IDS.reduce((acc, step) => {
      acc[step] = [] as BlogCanvasVersion[];
      return acc;
    }, {} as StepVersionsMap);

    (chatSession.state.messages ?? []).forEach(message => {
      if (!message || message.role !== 'assistant') return;
      const step = extractBlogStepFromModel(message.model);
      if (!step) return;

      const normalizedContent = normalizeCanvasContent(message.content);
      const version: BlogCanvasVersion = {
        id: message.id,
        content: normalizedContent,
        raw: message.content,
        step,
        createdAt: message.timestamp ? message.timestamp.getTime() : 0,
      };

      if (message.model) {
        version.model = message.model;
      }

      initialMap[step].push(version);
    });

    BLOG_STEP_IDS.forEach(step => {
      initialMap[step].sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.id.localeCompare(b.id);
      });
    });

    return initialMap;
  }, [chatSession.state.messages]);

  const hasStep7Content = (blogCanvasVersionsByStep.step7 ?? []).length > 0;

  useEffect(() => {
    const selectionUpdates: Partial<Record<BlogStepId, string | null>> = {};
    const followUpdates: Partial<Record<BlogStepId, boolean>> = {};
    let selectionChanged = false;
    let followChanged = false;

    BLOG_STEP_IDS.forEach(step => {
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;
      const currentSelection = selectedVersionByStep[step] ?? null;
      const followLatest = followLatestByStep[step] !== false;
      const currentExists =
        currentSelection !== null && versions.some(version => version.id === currentSelection);

      if (!versions.length) {
        if (currentSelection !== null) {
          selectionUpdates[step] = null;
          selectionChanged = true;
        }
        if (followLatestByStep[step] !== undefined && followLatestByStep[step] !== true) {
          followUpdates[step] = true;
          followChanged = true;
        }
        return;
      }

      if (!currentExists) {
        if (latestId) {
          selectionUpdates[step] = latestId;
          selectionChanged = true;
        }
        if (followLatestByStep[step] !== true) {
          followUpdates[step] = true;
          followChanged = true;
        }
        return;
      }

      if (followLatest && latestId && currentSelection !== latestId) {
        selectionUpdates[step] = latestId;
        selectionChanged = true;
      }
    });

    if (selectionChanged) {
      setSelectedVersionByStep(prev => {
        const next = { ...prev };
        BLOG_STEP_IDS.forEach(step => {
          if (Object.prototype.hasOwnProperty.call(selectionUpdates, step)) {
            next[step] = selectionUpdates[step] ?? null;
          }
        });
        return next;
      });
    }

    if (followChanged) {
      setFollowLatestByStep(prev => {
        const next = { ...prev };
        BLOG_STEP_IDS.forEach(step => {
          if (Object.prototype.hasOwnProperty.call(followUpdates, step)) {
            next[step] = followUpdates[step] ?? true;
          }
        });
        return next;
      });
    }
  }, [blogCanvasVersionsByStep, selectedVersionByStep, followLatestByStep]);

  const resolvedCanvasStep = useMemo<BlogStepId | null>(() => {
    if (canvasStep) return canvasStep;
    if (latestBlogStep) return latestBlogStep;
    return null;
  }, [canvasStep, latestBlogStep]);

  const canvasVersionsForStep = useMemo<BlogCanvasVersion[]>(() => {
    if (!resolvedCanvasStep) return [];
    return blogCanvasVersionsByStep[resolvedCanvasStep] ?? [];
  }, [blogCanvasVersionsByStep, resolvedCanvasStep]);

  const activeVersionId = resolvedCanvasStep
    ? (selectedVersionByStep[resolvedCanvasStep] ?? null)
    : null;

  // 見出し単位生成フロー用ステート・ロジック（カスタムフックで管理）
  const step5Content = useMemo(
    () =>
      [...(chatSession.state.messages ?? [])].reverse().find(m => m.model === 'blog_creation_step5')
        ?.content ?? null,
    [chatSession.state.messages]
  );

  const {
    headingSections,
    isSavingHeading,
    isHeadingInitInFlight,
    headingInitError,
    headingSaveError,
    activeHeadingIndex,
    activeHeading,
    latestCombinedContent,
    handleSaveHeadingSection: _handleSaveHeadingSection,
    handleRetryHeadingInit,
  } = useHeadingFlow({
    sessionId: chatSession.state.currentSessionId ?? null,
    isSessionLoading: chatSession.state.isLoading,
    step5Content,
    getAccessToken,
    resolvedCanvasStep,
  });

  const activeCanvasVersion = useMemo(() => {
    if (!resolvedCanvasStep) return null;
    const versions = blogCanvasVersionsByStep[resolvedCanvasStep] ?? [];
    if (!versions.length) return null;
    if (activeVersionId) {
      const matched = versions.find(version => version.id === activeVersionId);
      if (matched) return matched;
    }
    return versions[versions.length - 1];
  }, [resolvedCanvasStep, activeVersionId, blogCanvasVersionsByStep]);

  // 見出し保存後に activeHeadingIndex が進んでも Canvas は前見出しの本文のまま。
  // この状態で再保存すると誤保存になるため、新規生成が入るまで内容を空表示・保存無効化する。
  const prevActiveHeadingIndexRef = useRef<number | undefined>(undefined);
  const [isStep6ContentStale, setIsStep6ContentStale] = useState(false);
  const prevStep6SessionIdRef = useRef<string | null>(null);
  const step6Versions = blogCanvasVersionsByStep.step6 ?? [];
  const latestStep6Version = step6Versions[step6Versions.length - 1] ?? null;
  // 直前の確定見出しの updated_at より最新バージョンの createdAt が新しければ「現在見出し向け」と判定。
  // 注意: updated_at はサーバー (ISO8601)、createdAt はフロント (message.timestamp) 由来で時刻ソースが異なる。
  // 単一ユーザーフローでは問題にならない想定だが、差異による誤判定の可能性を留意すること。
  const hasContentForCurrentHeading = useMemo(() => {
    const headingIdx = activeHeadingIndex ?? 0;
    // 初回見出し: 最新Step6本文 or ストリーミング中本文が存在し空でなければ true（未生成のまま保存させない）
    if (headingIdx === 0) {
      const fromVersion = (latestStep6Version?.content?.trim().length ?? 0) > 0;
      const fromStreaming = (canvasStreamingContent?.trim().length ?? 0) > 0;
      return fromVersion || fromStreaming;
    }
    const prevHeading = headingSections[headingIdx - 1];
    if (!prevHeading?.isConfirmed) return false;
    const prevUpdatedMs = prevHeading.updatedAt
      ? new Date(prevHeading.updatedAt).getTime()
      : 0;
    const versionCreatedMs = latestStep6Version?.createdAt ?? 0;
    return versionCreatedMs > prevUpdatedMs;
  }, [activeHeadingIndex, headingSections, latestStep6Version, canvasStreamingContent]);

  // ステール判定を単一の effect に統合
  useEffect(() => {
    const currentSessionId = chatSession.state.currentSessionId ?? null;

    if (resolvedCanvasStep !== 'step6') {
      setIsStep6ContentStale(false);
      prevStep6SessionIdRef.current = currentSessionId;
      return;
    }

    // セッション切り替え時: ref をリセット
    if (prevStep6SessionIdRef.current !== currentSessionId) {
      prevStep6SessionIdRef.current = currentSessionId;
      prevActiveHeadingIndexRef.current = undefined;
    }

    // ストリーミング中は常に非ステール
    if (canvasStreamingContent) {
      setIsStep6ContentStale(false);
      prevActiveHeadingIndexRef.current = activeHeadingIndex;
      return;
    }

    // 現在見出し向けコンテンツがあれば非ステール
    if ((activeHeadingIndex ?? 0) > 0 && hasContentForCurrentHeading) {
      setIsStep6ContentStale(false);
      prevActiveHeadingIndexRef.current = activeHeadingIndex;
      return;
    }

    // 見出しが進んだ or 現在見出し向けコンテンツがない場合はステール（初回見出し含む）
    const prev = prevActiveHeadingIndexRef.current;
    const headingAdvanced =
      prev !== undefined &&
      activeHeadingIndex !== undefined &&
      activeHeadingIndex > prev;
    setIsStep6ContentStale(headingAdvanced || !hasContentForCurrentHeading);
    prevActiveHeadingIndexRef.current = activeHeadingIndex;
  }, [
    chatSession.state.currentSessionId,
    resolvedCanvasStep,
    activeHeadingIndex,
    hasContentForCurrentHeading,
    canvasStreamingContent,
  ]);

  const canvasContent = useMemo(() => {
    if (resolvedCanvasStep === 'step6') {
      // 全見出し確定済み → session_combined_contents の結合コンテンツを表示
      // 取得遅延/失敗時は activeCanvasVersion にフォールバック（空表示を防ぐ）
      if (!activeHeading && headingSections.length > 0) {
        return latestCombinedContent ?? activeCanvasVersion?.content ?? '';
      }
      // 確定済みの場合はDBに保存された確定コンテンツを優先
      if (activeHeading?.isConfirmed) {
        return activeHeading.content;
      }
      // 見出し遷移直後は前見出し本文を表示しない（誤保存防止）
      if (isStep6ContentStale) {
        return '';
      }
    }
    // 未確定の場合は最新のバージョン（生成中の内容含む）を表示
    return activeCanvasVersion?.content ?? '';
  }, [
    resolvedCanvasStep,
    activeHeading,
    headingSections.length,
    latestCombinedContent,
    activeCanvasVersion,
    isStep6ContentStale,
  ]);

  const canvasVersionsWithMeta = useMemo(() => {
    return canvasVersionsForStep.map((version, index) => ({
      ...version,
      versionNumber: index + 1,
      isLatest: index === canvasVersionsForStep.length - 1,
    }));
  }, [canvasVersionsForStep]);

  const canvasStepOptions = useMemo(
    () =>
      BLOG_STEP_IDS.filter(
        step => (blogCanvasVersionsByStep[step] ?? []).length > 0 && step !== nextStepForPlaceholder
      ),
    [blogCanvasVersionsByStep, nextStepForPlaceholder]
  );

  // handleSaveHeadingSection はフック側のシグネチャが (content: string) のため、ここでラップする。
  // CanvasPanel が contentRef に表示中の内容を随時更新するため、保存時は ref を優先して
  // ストリーミング完了直後のクリックでも最新編集内容が保存される。
  const handleSaveHeadingSection = useCallback(async () => {
    if (isStep6ContentStale) return;
    const contentToSave = canvasContentRef.current || canvasStreamingContent || canvasContent;
    await _handleSaveHeadingSection(contentToSave);
  }, [_handleSaveHeadingSection, canvasStreamingContent, canvasContent, isStep6ContentStale]);

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
    setCanvasStep(null);
    setSelectedVersionByStep({});
    setFollowLatestByStep({});
    setNextStepForPlaceholder(null);
    // 既存セッション間の切り替え時のみモデル選択をリセット
    if (shouldResetModel) {
      setSelectedModel('');
    }
    setIsEditingTitle(false);
    setTitleError(null);
    setIsSavingTitle(false);
    prevSessionIdRef.current = nextSessionId;
  }, [chatSession.state.currentSessionId]);

  useEffect(() => {
    if (!chatSession.state.currentSessionId) {
      setDraftTitle('');
      return;
    }

    if (isEditingTitle) {
      return;
    }

    if (currentSession) {
      setDraftTitle(currentSession.title);
    }
  }, [
    chatSession.state.currentSessionId,
    chatSession.state.sessions,
    currentSession,
    isEditingTitle,
  ]);

  const handleTitleEditStart = useCallback(() => {
    if (!chatSession.state.currentSessionId || !currentSession) {
      return;
    }
    setDraftTitle(currentSession.title);
    setTitleError(null);
    setIsEditingTitle(true);
  }, [chatSession.state.currentSessionId, currentSession]);

  const handleTitleEditChange = useCallback(
    (value: string) => {
      const sanitized = value.replace(/[\r\n]+/g, '');
      setDraftTitle(sanitized);
      if (titleError) {
        setTitleError(null);
      }
    },
    [titleError]
  );

  const handleTitleEditCancel = useCallback(() => {
    setIsEditingTitle(false);
    setTitleError(null);
    if (currentSession) {
      setDraftTitle(currentSession.title);
    }
  }, [currentSession]);

  const validateTitle = useCallback((value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 'タイトルを入力してください';
    }
    if (trimmed.length > 60) {
      return 'タイトルは60文字以内で入力してください';
    }
    return null;
  }, []);

  const handleTitleEditConfirm = useCallback(async () => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId || !currentSession) {
      return;
    }

    if (isSavingTitle) {
      return;
    }

    const trimmed = draftTitle.trim();
    const validationError = validateTitle(trimmed);
    if (validationError) {
      setTitleError(validationError);
      return;
    }

    if (currentSession.title === trimmed) {
      setIsEditingTitle(false);
      setTitleError(null);
      return;
    }

    setIsSavingTitle(true);
    try {
      await chatSession.actions.updateSessionTitle(sessionId, trimmed);
      setIsEditingTitle(false);
      setTitleError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'タイトルの更新に失敗しました。時間をおいて再試行してください。';
      setTitleError(message);
    } finally {
      setIsSavingTitle(false);
    }
  }, [
    chatSession.actions,
    chatSession.state.currentSessionId,
    currentSession,
    draftTitle,
    validateTitle,
    isSavingTitle,
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

  // ✅ Canvasボタンクリック時にCanvasPanelを表示する関数
  const handleShowCanvas = useCallback(
    (message: ChatMessage) => {
      const fallbackStep = (latestBlogStep ?? BLOG_STEP_IDS[0]) as BlogStepId;
      const detectedStep = (extractBlogStepFromModel(message.model) ?? fallbackStep) as BlogStepId;
      const versions = blogCanvasVersionsByStep[detectedStep] ?? [];
      const latestVersionId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;
      const hasExactMatch = versions.some(version => version.id === message.id);
      const targetVersionId = hasExactMatch ? message.id : latestVersionId;

      if (message.id.startsWith('temp-assistant-')) {
        const normalizedStreaming = normalizeCanvasContent(message.content ?? '');
        if (normalizedStreaming) {
          setCanvasStreamingContent(normalizedStreaming);
        }
      } else {
        setCanvasStreamingContent('');
      }

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

      if (annotationOpen) {
        setAnnotationOpen(false);
        setAnnotationData(null);
      }
      setCanvasPanelOpen(true);
    },
    [annotationOpen, blogCanvasVersionsByStep, latestBlogStep, setCanvasStreamingContent]
  );

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

  const handleGenerateTitleMeta = async () => {
    const sessionId = chatSession.state.currentSessionId;
    if (!sessionId) return;

    setIsGeneratingTitleMeta(true);
    try {
      const accessToken = await getAccessToken();
      const res = await getLatestBlogStep7MessageBySession(sessionId, accessToken);
      if (!res.success) {
        const errorMessage = res.error || '本文の取得に失敗しました';
        chatSession.actions.setError(errorMessage);
        return;
      }
      if (!res.data?.content?.trim()) {
        chatSession.actions.setError('本文が見つかりませんでした');
        return;
      }

      const systemPrompt = `${TITLE_META_SYSTEM_PROMPT}\n\n本文:\n${res.data.content}`;
      await chatSession.actions.sendMessage(
        '本文を元にタイトルと説明文を作成してください。',
        'blog_title_meta_generation',
        { systemPrompt }
      );
    } catch (error) {
      console.error('Failed to generate title/meta:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'タイトル・説明文の生成に失敗しました';
      chatSession.actions.setError(errorMessage);
    } finally {
      setIsGeneratingTitleMeta(false);
    }
  };

  const handleCanvasVersionSelect = useCallback(
    (versionId: string) => {
      const step = resolvedCanvasStep;
      if (!step) return;
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;

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
    [blogCanvasVersionsByStep, resolvedCanvasStep]
  );

  const handleCanvasStepChange = useCallback(
    (step: BlogStepId) => {
      const versions = blogCanvasVersionsByStep[step] ?? [];
      const latestId = versions.length ? (versions[versions.length - 1]?.id ?? null) : null;

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
    [blogCanvasVersionsByStep]
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
          targetStep = stepInfo?.currentStep ?? latestBlogStep ?? 'step1';
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
          model: `blog_creation_${targetStep}`,
        };

        const assistantCanvasMessage: ChatMessage = {
          id: tempAssistantCanvasId,
          role: 'assistant',
          content: '', // ストリーミング中は空
          timestamp: new Date(),
          model: `blog_creation_${targetStep}`,
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
      annotationOpen,
      chatSession.actions,
      chatSession.state.currentSessionId,
      getAccessToken,
      handleModelChange,
      isOwnerViewMode,
      latestBlogStep,
      resolvedCanvasStep,
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
          totalHeadings: headingSections.length,
          ...(activeHeadingIndex !== undefined && { headingIndex: activeHeadingIndex }),
          ...(activeHeading?.headingText !== undefined && {
            currentHeadingText: activeHeading.headingText,
          }),
          initialStep,
          services,
          selectedServiceId,
          onServiceChange: handleServiceChange,
          servicesError,
          onDismissServicesError: dismissServicesError,
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
          activeVersionId={activeCanvasVersion?.id ?? null}
          onVersionSelect={handleCanvasVersionSelect}
          stepOptions={canvasStepOptions}
          activeStepId={resolvedCanvasStep ?? null}
          onStepSelect={handleCanvasStepSelect}
          streamingContent={canvasStreamingContent}
          canvasContentRef={canvasContentRef}
          // 見出し単位生成フロー用（exactOptionalPropertyTypes のため undefined 時は渡さない）
          {...(activeHeadingIndex !== undefined && { headingIndex: activeHeadingIndex })}
          totalHeadings={headingSections.length}
          {...(activeHeading?.headingText !== undefined && {
            currentHeadingText: activeHeading.headingText,
          })}
          onSaveHeadingSection={handleSaveHeadingSection}
          isSavingHeading={isSavingHeading}
          isStep6SaveDisabled={isStep6ContentStale}
          headingSaveError={headingSaveError}
          headingInitError={headingInitError}
          onRetryHeadingInit={handleRetryHeadingInit}
          isRetryingHeadingInit={isHeadingInitInFlight}
          isStreaming={isCanvasStreaming}
        />
      )}
    </div>
  );
};
