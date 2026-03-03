import { ChatSessionHook } from '@/hooks/useChatSession';
import { SubscriptionHook } from '@/hooks/useSubscriptionStatus';
import { ChatMessage } from '@/domain/interfaces/IChatService';
import { BlogStepId } from '@/lib/constants';
import type { SessionHeadingSection } from '@/types/heading-flow';
import { Service } from '@/server/schemas/brief.schema';
import type { AnnotationRecord } from '@/types/annotation';
import type { StepActionBarRef } from '@/../app/chat/components/StepActionBar';

export interface ChatLayoutProps {
  chatSession: ChatSessionHook;
  subscription: SubscriptionHook;
  isMobile?: boolean;
  initialStep?: BlogStepId | null;
}

export interface BlogCanvasVersion {
  id: string;
  content: string;
  raw: string;
  step: BlogStepId;
  model?: string;
  createdAt: number;
  createdAtIso: string | null;
}

export type StepVersionsMap = Record<BlogStepId, BlogCanvasVersion[]>;

// 自動開始は行わず、明示ボタンで開始する
export interface ChatLayoutCtx {
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
  onBeforeManualStepChange: (params: {
    direction: 'forward' | 'backward';
    currentStep: BlogStepId;
    targetStep: BlogStepId;
  }) => boolean;
  onManualStepChange?: (targetStep: BlogStepId) => void;
  isHeadingInitInFlight: boolean;
  hasAttemptedHeadingInit: boolean;
  onRetryHeadingInit?: () => void;
  isSavingHeading: boolean;
  headingIndex?: number;
  totalHeadings: number;
  currentHeadingText?: string;
  headingSections: SessionHeadingSection[];
  initialStep?: BlogStepId | null;
  services: Service[];
  selectedServiceId: string | null;
  onServiceChange: (serviceId: string) => void;
  servicesError: string | null;
  onDismissServicesError: () => void;
  onResetHeadingConfiguration: () => Promise<boolean>;
  resolvedCanvasStep: BlogStepId | null;
  setCanvasStep: (step: BlogStepId | null) => void;
  /** Step7: 現在生成対象の見出しインデックス。undefined = 完成形フェーズ */
  activeHeadingIndex?: number;
  /** Step7: 見出し保存ボタン無効化 */
  isStep7SaveDisabled?: boolean;
  /** Step7: 見出し生成トリガー */
  onStartHeadingGeneration?: (headingIndex: number) => void;
  /** Step7: 見出し保存（保存して次へ） */
  onSaveHeadingSection?: () => Promise<void>;
  /** チャットローディング中 */
  isChatLoading?: boolean;
  /** Step7 完成形フェーズ: 書き出し+各見出しを結合して保存（AI 不使用） */
  onBuildCombinedWithUserLead?: (userProvidedLead: string) => Promise<{ success: boolean; error?: string }>;
  /** Step7 完成形を1回以上保存済みのとき true。保存後は通常送信を許可する */
  hasCombinedContentSaved?: boolean;
}
