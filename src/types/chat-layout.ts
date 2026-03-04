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
  onResetHeadingConfiguration: (options?: { preserveStep7Lead?: boolean }) => Promise<boolean>;
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
  /** Step7 最後の見出し: 保存＋全文結合を実行（本文生成ボタン用） */
  onSaveLastHeadingAndBuildCombined?: () => Promise<void>;
  /** チャットローディング中 */
  isChatLoading?: boolean;
  /** 本文生成（完成形構築）中 */
  isBuildingCombined?: boolean;
  /** Step7 完成形フェーズ: 書き出し+各見出しを結合して保存（再確定後も再保存可能） */
  onBuildCombinedWithUserLead?: (userProvidedLead: string) => Promise<{ success: boolean; error?: string }>;
  /** Step6→Step7: 書き出し案を保存のみ（AI呼び出しなし） */
  onSaveStep7UserLead?: (userLead: string) => Promise<{ success: boolean; error?: string }>;
  /** Step6→Step7 で書き出し案保存済み。step7 表示に遷移するためのフラグ */
  step6ToStep7LeadSaved?: boolean;
  /** Step7 完成形: タイル表示用。表示時はメッセージ末尾に完成形タイルを出す */
  combinedTile?: { show: boolean; title: string; excerpt: string };
  /** Step7 完成形タイルクリック時: Canvas で完成形を開く */
  onOpenCombinedCanvas?: () => void;
}
