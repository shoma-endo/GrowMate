'use client';

import React, { useState, useRef, useCallback, useEffect, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Bot, Send, Menu, Pencil, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BLOG_PLACEHOLDERS,
  FIRST_BLOG_STEP_ID,
  STEP7_ID,
  STEP6_ID,
  STEP7_HEADING_PLACEHOLDER_KEY,
  toBlogModel,
  type BlogStepId,
} from '@/lib/constants';
import { TITLE_MAX_LENGTH } from '@/lib/validators/common';
import { useLiffContext } from '@/components/LiffProvider';
import StepActionBar, { StepActionBarRef } from './StepActionBar';
import ChatSearch from './search/ChatSearch';
import { ServiceSelector } from './ServiceSelector';
import { Service } from '@/server/schemas/brief.schema';

// 使用可能なモデル一覧
const AVAILABLE_MODELS = {
  'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2': 'キーワード選定',
  ad_copy_creation: '広告文作成',
  ad_copy_finishing: '広告文仕上げ',
  lp_draft_creation: 'LPドラフト作成',
  lp_improvement: 'LP改善',
  blog_creation: 'ブログ作成',
};

// モデルごとのプレースホルダー文言
const MODEL_PLACEHOLDERS: Record<string, string> = {
  'ft:gpt-4.1-nano-2025-04-14:personal::BZeCVPK2': 'SEOキーワードを改行区切りで入力してください',
  ad_copy_creation: '競合の広告文を入力してください',
  ad_copy_finishing: '広告文の改善・修正指示などを入力してください',
  lp_draft_creation: '広告見出しと説明文を入力してください',
  lp_improvement: 'LPの改善・修正指示などを入力してください',
  ...BLOG_PLACEHOLDERS,
};

interface InputAreaProps {
  onSendMessage: (content: string, model: string) => Promise<void>;
  disabled: boolean;
  currentSessionTitle?: string | undefined;
  currentSessionId?: string | undefined;
  isMobile?: boolean | undefined;
  onMenuToggle?: (() => void) | undefined;
  blogFlowActive?: boolean;
  blogProgress?: { currentIndex: number; total: number };
  onModelChange?: (model: string, blogStep?: BlogStepId) => void;
  blogFlowStatus?: string;
  selectedModelExternal?: string;
  initialBlogStep?: BlogStepId;
  /** ヒント・プレースホルダー・送信先の単一ソース（親で算出）。通常チャットは常にこれを使用。Canvas の AI 生成は CanvasPanel 経由で分離。 */
  nextStepForSend?: BlogStepId;
  /** プレースホルダー用ステップ（ヒントと整合） */
  stepForPlaceholder?: BlogStepId;
  /** プレースホルダー用キー（step5→6 の AI 取得時は STEP6_GET_PLACEHOLDER_KEY） */
  placeholderKey?: string;
  isEditingTitle?: boolean;
  draftSessionTitle?: string;
  sessionTitleError?: string | null;
  onSessionTitleEditStart?: () => void;
  onSessionTitleEditChange?: (value: string) => void;
  onSessionTitleEditCancel?: () => void;
  onSessionTitleEditConfirm?: () => void;
  isSavingSessionTitle?: boolean;
  // StepActionBar props
  shouldShowStepActionBar?: boolean;
  stepActionBarRef?: React.RefObject<StepActionBarRef | null>;
  displayStep?: BlogStepId;
  /** StepActionBar「現在のステップ」表示用。持っている成果物のstep（content step） */
  stepForStepActionBar?: BlogStepId;
  hasDetectedBlogStep?: boolean;
  onSaveClick?: () => void;
  annotationLoading?: boolean;
  isSavingHeading?: boolean;
  hasStep7Content?: boolean;
  onGenerateTitleMeta?: () => void;
  isGenerateTitleMetaLoading?: boolean;
  stepActionBarDisabled?: boolean;
  onNextStepChange?: (nextStep: BlogStepId | null) => void;
  onLoadBlogArticle?: (() => Promise<void>) | undefined;
  onManualStepChange?: (step: BlogStepId) => void;
  onBeforeManualStepChange?: (params: {
    direction: 'forward' | 'backward';
    currentStep: BlogStepId;
    targetStep: BlogStepId;
  }) => boolean;
  isHeadingInitInFlight?: boolean;
  hasAttemptedHeadingInit?: boolean;
  onRetryHeadingInit?: () => void;
  headingIndex?: number;
  totalHeadings?: number;
  currentHeadingText?: string;
  searchQuery: string;
  searchError: string | null;
  isSearching: boolean;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  selectedServiceId?: string | null;
  onServiceChange?: (serviceId: string) => void;
  onResetHeadingConfiguration?: (options?: { preserveStep7Lead?: boolean }) => Promise<boolean>;
  services?: Service[];
  /** Step7: 現在生成対象の見出しインデックス。undefined = 完成形フェーズ */
  activeHeadingIndex?: number;
  /** Step7: 見出し保存ボタン無効化 */
  isStep7SaveDisabled?: boolean;
  /** Step7: 見出し生成トリガー */
  onStartHeadingGeneration?: (headingIndex: number) => void;
  /** Step7: 見出し保存 */
  onSaveHeadingSection?: () => Promise<void>;
  /** Step7 全見出し保存後: 結合のみ実行（本文生成ボタン用） */
  onBuildCombinedOnly?: () => Promise<void>;
  /** チャットローディング中 */
  isChatLoading?: boolean;
  /** 本文生成（完成形構築）中 */
  isBuildingCombined?: boolean;
  /** Step7 完成形: 書き出し+各見出しを結合して保存（再確定後も再保存可能） */
  /** Step7: 書き出し案を保存して見出し生成スタート */
  onSaveStep7UserLead?: (userLead: string) => Promise<{ success: boolean; error?: string }>;
  /** Step6→Step7 保存成功時に step7 表示へ遷移（manualBlogStep を step7 に更新） */
  onStep6ToStep7Success?: () => void;
  /** true のとき step6→7 保存をスキップ（構成案の場合は書き出し案取得の通常送信） */
  lastAssistantIsBasicStructure?: boolean;
}

const InputArea: React.FC<InputAreaProps> = ({
  onSendMessage,
  disabled,
  currentSessionTitle,
  currentSessionId,
  isMobile: propIsMobile,
  onMenuToggle,
  blogFlowActive = false,
  blogProgress,
  onModelChange,
  blogFlowStatus,
  selectedModelExternal,
  initialBlogStep,
  nextStepForSend,
  stepForPlaceholder: stepForPlaceholderProp,
  placeholderKey: placeholderKeyProp,
  isEditingTitle = false,
  draftSessionTitle,
  sessionTitleError,
  onSessionTitleEditStart,
  onSessionTitleEditChange,
  onSessionTitleEditCancel,
  onSessionTitleEditConfirm,
  isSavingSessionTitle = false,
  shouldShowStepActionBar,
  stepActionBarRef,
  displayStep,
  stepForStepActionBar,
  hasDetectedBlogStep,
  onSaveClick,
  annotationLoading,
  isSavingHeading,
  hasStep7Content,
  onGenerateTitleMeta,
  isGenerateTitleMetaLoading,
  stepActionBarDisabled,
  onNextStepChange,
  onLoadBlogArticle,
  onManualStepChange,
  onBeforeManualStepChange,
  isHeadingInitInFlight,
  hasAttemptedHeadingInit,
  onRetryHeadingInit,
  headingIndex,
  totalHeadings,
  currentHeadingText,
  searchQuery,
  searchError,
  isSearching,
  onSearch,
  onClearSearch,
  services,
  selectedServiceId,
  onServiceChange,
  onResetHeadingConfiguration,
  activeHeadingIndex,
  isStep7SaveDisabled = true,
  onStartHeadingGeneration,
  onSaveHeadingSection,
  onBuildCombinedOnly,
  isChatLoading = false,
  isBuildingCombined = false,
  onSaveStep7UserLead,
  onStep6ToStep7Success,
  lastAssistantIsBasicStructure = false,
}) => {
  const { isOwnerViewMode } = useLiffContext();
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = propIsMobile ?? false;
  const titleErrorId = useId();
  const isReadOnly = isOwnerViewMode;
  const isTitleEditable = Boolean(currentSessionId) && !isReadOnly;
  const effectiveDraftTitle = draftSessionTitle ?? currentSessionTitle ?? '';
  const [isLoadingBlogArticle, setIsLoadingBlogArticle] = useState(false);
  const [blogArticleError, setBlogArticleError] = useState<string | null>(null);

  const isModelSelected = Boolean(selectedModel);
  const isStepActionBarDisabled = Boolean(stepActionBarDisabled || isReadOnly);

  // 送信モデル: 通常チャットは nextStepForSend のみ。Canvas の AI 生成は CanvasPanel 経由で分離。
  const targetBlogStep =
    nextStepForSend ?? displayStep ?? initialBlogStep ?? FIRST_BLOG_STEP_ID;
  // プレースホルダーはヒントと整合（親で算出。未指定時は displayStep にフォールバック）
  const stepForPlaceholder =
    stepForPlaceholderProp ?? displayStep ?? initialBlogStep ?? FIRST_BLOG_STEP_ID;

  // Step7 見出し生成フェーズ: 見出し生成・保存ボタン表示用（入力は無効）
  const isStep7HeadingPhase =
    displayStep === STEP7_ID &&
    selectedModel === 'blog_creation' &&
    activeHeadingIndex !== undefined &&
    (totalHeadings ?? 0) > 0;
  const isInputDisabled =
    disabled || !isModelSelected || isReadOnly || isStep7HeadingPhase;

  // ブログ作成のプレースホルダーはUIヒント用ステップを表示
  const placeholderMessage = (() => {
    if (!isModelSelected) {
      return '画面上部のチャットモデルを選択してください';
    }

    // Step7 見出し生成フェーズ: 入力無効時（BLOG_PLACEHOLDERS で一元管理）
    if (isStep7HeadingPhase) {
      return BLOG_PLACEHOLDERS[STEP7_HEADING_PLACEHOLDER_KEY];
    }
    // Step7 完成形フェーズ: 書き出し案入力を案内
    if (selectedModel === 'blog_creation' && displayStep === STEP7_ID) {
      return BLOG_PLACEHOLDERS[toBlogModel(STEP7_ID)];
    }

    if (selectedModel === 'blog_creation') {
      const key = (placeholderKeyProp ?? `blog_creation_${stepForPlaceholder}`) as keyof typeof BLOG_PLACEHOLDERS;
      return BLOG_PLACEHOLDERS[key] ?? BLOG_PLACEHOLDERS[toBlogModel(FIRST_BLOG_STEP_ID)];
    }

    // 通常モデル
    return MODEL_PLACEHOLDERS[selectedModel] ?? 'チャットモデルを選択してください';
  })();

  useEffect(() => {
    if (!isModelSelected) {
      setInput('');
    }
  }, [isModelSelected]);

  // ✅ セッション変更時に入力をクリア（モデル選択は外部から制御される）
  const prevSessionIdRef = useRef<string | undefined>(currentSessionId);
  /** ブログ同期effect用: セッション切り替え検知（前回実行時の sessionId を保持） */
  const prevSessionForBlogSyncRef = useRef<string | undefined>(currentSessionId);
  useEffect(() => {
    // セッションIDが変更された場合のみ実行
    if (prevSessionIdRef.current !== undefined && prevSessionIdRef.current !== currentSessionId) {
      // 入力をクリア
      setInput('');
    }

    // 現在のセッションIDを記録
    prevSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (selectedModelExternal !== undefined && selectedModelExternal !== selectedModel) {
      setSelectedModel(selectedModelExternal);
    }
  }, [selectedModelExternal, selectedModel]);

  // 既存チャットルームを開いた際、ブログフローが検出されたセッションのみフロー状態に合わせてブログ作成モデルに合わせる。
  // - hasDetectedBlogStep が false のとき（LPドラフト専用セッション等）は切り替えない。
  // - 同一セッション内で selectedModel が空でないとき（ユーザーが明示的に他モデルを選択済み）は切り替えない。途中から他モデルに切り替えた選択を尊重。
  // - セッション切り替え直後は selectedModel が前セッションのままの可能性があるため、sessionJustSwitched のときは !selectedModel を要求しない（回帰防止）。
  useEffect(() => {
    // undefined→session の初回オープンもセッション切り替えとして扱う（LP事前選択後にブログセッションを開くケース等）
    const sessionJustSwitched = prevSessionForBlogSyncRef.current !== currentSessionId;
    prevSessionForBlogSyncRef.current = currentSessionId;

    const shouldSyncToBlog =
      hasDetectedBlogStep &&
      blogFlowStatus &&
      blogFlowStatus !== 'idle' &&
      selectedModel !== 'blog_creation' &&
      (sessionJustSwitched || !selectedModel);

    if (shouldSyncToBlog) {
      setSelectedModel('blog_creation');
      onModelChange?.('blog_creation', initialBlogStep);
    }
  }, [
    currentSessionId,
    hasDetectedBlogStep,
    blogFlowStatus,
    selectedModel,
    onModelChange,
    initialBlogStep,
  ]);

  const handleLoadBlogArticle = useCallback(async () => {
    if (!onLoadBlogArticle || isLoadingBlogArticle) return;
    setBlogArticleError(null);
    setIsLoadingBlogArticle(true);
    try {
      await onLoadBlogArticle();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ブログ記事の取得に失敗しました';
      setBlogArticleError(message);
    } finally {
      setIsLoadingBlogArticle(false);
    }
  }, [onLoadBlogArticle, isLoadingBlogArticle]);

  useEffect(() => {
    setBlogArticleError(null);
    setIsLoadingBlogArticle(false);
  }, [currentSessionId]);

  // テキストエリアの高さを自動調整する関数
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';

      if (!input) {
        textarea.style.height = isMobile ? '32px' : '40px';
        return;
      }

      const maxHeight = isMobile ? 120 : 150;
      const textareaHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${textareaHeight}px`;
    }
  }, [input, isMobile]);

  // 入力が変更されたときにテキストエリアの高さを調整
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isInputDisabled) return;
    setInput(e.target.value);
    adjustTextareaHeight();
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  const [isSavingStep7Lead, setIsSavingStep7Lead] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isInputDisabled) return;

    const originalMessage = trimmedInput;

    // Step6→Step7: 書き出し案を step7_lead として保存のみ（AI呼び出しなし）。
    // 構成案表示中は lastAssistantIsBasicStructure=true のため、通常送信で書き出し案生成に進む。
    // targetBlogStep を使用（通常チャットは nextStepForSend ベースで step6→7 判定）
    const isStep6ToStep7Transition =
      displayStep === STEP6_ID &&
      targetBlogStep === STEP7_ID &&
      selectedModel === 'blog_creation' &&
      onSaveStep7UserLead &&
      !lastAssistantIsBasicStructure;
    if (isStep6ToStep7Transition) {
      setIsSavingStep7Lead(true);
      try {
        const res = await onSaveStep7UserLead(originalMessage);
        if (res.success) {
          onStep6ToStep7Success?.();
          setInput('');
          toast.success('書き出し案を保存しました。見出し生成ボタンで1つ目の見出しを生成してください。');
          return;
        }
        toast.error(res.error ?? '書き出し案の保存に失敗しました');
        return;
      } finally {
        setIsSavingStep7Lead(false);
      }
    }

    // Step7: 書き出し案入力あり → 保存＋見出しセクション削除で見出し1から再スタート（見出し生成中・完成形後いずれも同様）
    if (
      displayStep === STEP7_ID &&
      selectedModel === 'blog_creation' &&
      trimmedInput &&
      onSaveStep7UserLead &&
      onResetHeadingConfiguration
    ) {
      // 見出しが見つかりません状態では、基本構成に ###/#### を記載してから再試行するよう警告
      const isHeadingNotFoundError =
        (totalHeadings ?? 0) === 0 &&
        (hasAttemptedHeadingInit ?? false) &&
        !(isHeadingInitInFlight ?? false);
      if (isHeadingNotFoundError) {
        toast.warning(
          '見出しが見つかりません。メモ・補足情報の「基本構成」に ###/#### 形式で見出しを記載してから、再試行してください。'
        );
        return;
      }
      setIsSavingStep7Lead(true);
      try {
        const res = await onSaveStep7UserLead(originalMessage);
        if (res.success) {
          setInput('');
          const resetOk = await onResetHeadingConfiguration({ preserveStep7Lead: true });
          if (resetOk) {
            toast.success('書き出し案を保存しました。見出し1から再スタートします。');
            return;
          } else {
            toast.error('見出し構成のリセットに失敗しました');
            return;
          }
        } else {
          toast.error(res.error ?? '書き出し案の保存に失敗しました');
          return;
        }
      } finally {
        setIsSavingStep7Lead(false);
      }
    }

    // 通常のチャット送信
    let effectiveModel: string = selectedModel;
    if (selectedModel === 'blog_creation') {
      effectiveModel = `blog_creation_${targetBlogStep}`;
      onModelChange?.('blog_creation', targetBlogStep);
    }

    setInput('');
    await onSendMessage(originalMessage, effectiveModel);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-border shadow-sm h-16">
        <div className="px-4 h-full flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="hidden lg:block w-72">
              <ChatSearch
                query={searchQuery}
                isSearching={isSearching}
                error={searchError}
                onSearch={onSearch}
                onClear={onClearSearch}
                className="space-y-1"
              />
            </div>
            {isMobile && onMenuToggle && (
              <Button variant="ghost" size="icon" onClick={onMenuToggle} aria-label="メニュー">
                <Menu className="h-5 w-5" />
              </Button>
            )}
            <div className="flex items-center space-x-2">
              <Bot className="h-6 w-6 text-[#06c755]" />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  {isEditingTitle ? (
                    <>
                      <Input
                        value={effectiveDraftTitle}
                        onChange={event => onSessionTitleEditChange?.(event.target.value)}
                        className="h-8 w-[160px] md:w-[240px] text-sm"
                        placeholder="チャットタイトルを入力"
                        autoFocus
                        maxLength={TITLE_MAX_LENGTH}
                        disabled={isSavingSessionTitle || isReadOnly}
                        aria-label="チャットタイトルを入力"
                        aria-invalid={sessionTitleError ? true : false}
                        aria-describedby={sessionTitleError ? titleErrorId : undefined}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onSessionTitleEditConfirm?.();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            onSessionTitleEditCancel?.();
                          }
                        }}
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onSessionTitleEditConfirm?.()}
                          disabled={isSavingSessionTitle || isReadOnly}
                          aria-label="タイトルを保存"
                          className="h-8 w-8 text-[#06c755]"
                        >
                          {isSavingSessionTitle ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Check className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onSessionTitleEditCancel?.()}
                          aria-label="タイトル編集をキャンセル"
                          className="h-8 w-8 text-gray-500"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={cn(
                        'group flex items-center gap-2 text-left focus-visible:ring-2 focus-visible:ring-[#06c755]/40 rounded px-2 py-1 transition',
                        isTitleEditable ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'
                      )}
                      onClick={() => {
                        if (!isTitleEditable) return;
                        onSessionTitleEditStart?.();
                      }}
                      aria-label="タイトルを編集"
                      disabled={!isTitleEditable}
                    >
                      <span className="font-medium text-sm md:text-base truncate max-w-[120px] md:max-w-[250px]">
                        {currentSessionTitle || '新しいチャット'}
                      </span>
                      {isTitleEditable && (
                        <Pencil
                          className="h-4 w-4 text-gray-400 group-hover:text-[#06c755]"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  )}
                  {blogFlowActive && blogProgress && (
                    <span className="text-xs text-gray-500 bg-blue-50 px-2 py-1 rounded">
                      {blogProgress.currentIndex + 1}/{blogProgress.total}
                    </span>
                  )}
                </div>
                {isEditingTitle && sessionTitleError && (
                  <p
                    id={titleErrorId}
                    className="text-xs text-red-500 mt-1"
                    role="alert"
                    aria-live="polite"
                  >
                    {sessionTitleError}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {services && services.length > 1 && onServiceChange && (
              <ServiceSelector
                services={services}
                selectedServiceId={selectedServiceId ?? null}
                onServiceChange={onServiceChange}
                disabled={disabled || isReadOnly}
                className="hidden md:flex"
              />
            )}
            <Select
              {...(isModelSelected ? { value: selectedModel } : {})}
              disabled={isReadOnly}
              onValueChange={value => {
                setSelectedModel(value);
                if (value === 'blog_creation') {
                  const targetStep: BlogStepId = initialBlogStep ?? FIRST_BLOG_STEP_ID;
                  onModelChange?.(value, targetStep);
                } else {
                  onModelChange?.(value);
                }
              }}
            >
              <SelectTrigger className="w-[120px] md:w-[180px] min-w-[120px] h-9 text-xs md:text-sm border-gray-200">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AVAILABLE_MODELS).map(([modelId, modelName]) => (
                  <SelectItem key={modelId} value={modelId}>
                    {modelName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedModel === 'blog_creation' && (
              <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-1">
                作成ステップは自動で進行します
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="lg:hidden px-4 mt-16 py-2 bg-background border-b border-border">
        <ChatSearch
          query={searchQuery}
          isSearching={isSearching}
          error={searchError}
          onSearch={onSearch}
          onClear={onClearSearch}
          className="space-y-1"
        />
        {services && services.length > 1 && onServiceChange && (
          <div className="md:hidden mt-2">
            <ServiceSelector
              services={services}
              selectedServiceId={selectedServiceId ?? null}
              onServiceChange={onServiceChange}
              disabled={disabled || isReadOnly}
            />
          </div>
        )}
      </div>

      {/* 入力エリア - レイアウトで既にpadding-topが設定されているため調整 */}
      <div className="border-t bg-white">
        {shouldShowStepActionBar && (
          <div className="px-3 py-3 border-b border-gray-200 bg-white shadow-sm">
            <StepActionBar
              ref={stepActionBarRef}
              {...(displayStep !== undefined && {
                step: stepForStepActionBar ?? displayStep,
                stepForNavigation: displayStep,
              })}
              {...(hasDetectedBlogStep !== undefined && { hasDetectedBlogStep })}
              {...(nextStepForSend !== undefined && { nextStepForSend })}
              className="flex-wrap gap-3"
              disabled={isStepActionBarDisabled}
              {...(onSaveClick !== undefined && { onSaveClick })}
              {...(annotationLoading !== undefined && { annotationLoading })}
              {...(isSavingHeading !== undefined && { isSavingHeading })}
              {...(hasStep7Content !== undefined && { hasStep7Content })}
              {...(onGenerateTitleMeta !== undefined && { onGenerateTitleMeta })}
              {...(isGenerateTitleMetaLoading !== undefined && {
                isGenerateTitleMetaLoading,
              })}
              {...(onNextStepChange !== undefined && { onNextStepChange })}
              {...(blogFlowStatus !== undefined && { flowStatus: blogFlowStatus })}
              onLoadBlogArticle={handleLoadBlogArticle}
              isLoadBlogArticleLoading={isLoadingBlogArticle}
              {...(onManualStepChange !== undefined && { onManualStepChange })}
              {...(onBeforeManualStepChange !== undefined && { onBeforeManualStepChange })}
              {...(isHeadingInitInFlight !== undefined && { isHeadingInitInFlight })}
              {...(hasAttemptedHeadingInit !== undefined && { hasAttemptedHeadingInit })}
              {...(onRetryHeadingInit !== undefined && { onRetryHeadingInit })}
              {...(headingIndex !== undefined && { headingIndex })}
              {...(totalHeadings !== undefined && { totalHeadings })}
              {...(currentHeadingText !== undefined && { currentHeadingText })}
              {...(activeHeadingIndex !== undefined && { activeHeadingIndex })}
              isStep7SaveDisabled={isStep7SaveDisabled}
              {...(onStartHeadingGeneration && { onStartHeadingGeneration })}
              {...(onSaveHeadingSection && { onSaveHeadingSection })}
              {...(onBuildCombinedOnly && { onBuildCombinedOnly })}
              isChatLoading={isChatLoading}
              isBuildingCombined={isBuildingCombined}
            />
            {blogArticleError && <p className="mt-2 text-xs text-red-500">{blogArticleError}</p>}
          </div>
        )}
        <div className="px-3 py-2">
          <form onSubmit={handleSubmit} className="relative">
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2 bg-slate-100 rounded-xl pr-2 pl-4 focus-within:ring-1 focus-within:ring-[#06c755]/30 transition-all duration-150 relative">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  placeholder={placeholderMessage}
                  disabled={isInputDisabled}
                  className={cn(
                    'flex-1 border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 py-2 h-auto resize-none overflow-y-auto transition-all duration-150',
                    isMobile ? 'min-h-8' : 'min-h-10',
                    input ? (isMobile ? 'max-h-[120px]' : 'max-h-[150px]') : ''
                  )}
                  rows={1}
                />
                <div className="flex gap-1 items-center">
                  <Button
                    type="submit"
                    size="icon"
                    disabled={
                      isInputDisabled ||
                      !input.trim() ||
                      isBuildingCombined ||
                      isSavingStep7Lead
                    }
                    className="rounded-full size-10 bg-[#06c755] hover:bg-[#05b64b] mt-1"
                  >
                    {(isBuildingCombined || isSavingStep7Lead) ? (
                      <Loader2 size={18} className="text-white animate-spin" />
                    ) : (
                      <Send size={18} className="text-white" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default InputArea;
