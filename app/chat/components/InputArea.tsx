'use client';

import React, { useState, useRef, useCallback, useEffect, useId, useMemo } from 'react';
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
import { cn } from '@/lib/utils';
import { BLOG_PLACEHOLDERS, BLOG_STEP_IDS, BlogStepId } from '@/lib/constants';
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
  nextStepForPlaceholder?: BlogStepId | null;
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
  /** Step5で入力内容をそのまま構成案として保存（AI経由なし） */
  onSaveManualStep5?: (
    content: string
  ) => Promise<{ success: true } | { success: false; error: string }>;
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
  onResetHeadingConfiguration?: () => Promise<void>;
  isLegacyStep6ResetEligible?: boolean;
  services?: Service[];
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
  nextStepForPlaceholder,
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
  onSaveManualStep5,
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
  isLegacyStep6ResetEligible = false,
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
  const [isSavingManualStep5, setIsSavingManualStep5] = useState(false);

  const isModelSelected = Boolean(selectedModel);
  const isInputDisabled = disabled || !isModelSelected || isReadOnly;
  const isStepActionBarDisabled = Boolean(stepActionBarDisabled || isReadOnly);

  /**
   * ブログ作成で「今回の入力をどのステップとして送るか」を一元化する。
   * プレースホルダー表示と API/DB 送信モデルで同じ値を使い、表示と保存先の不整合を防ぐ。
   */
  const targetBlogStep = useMemo<BlogStepId>(() => {
    if (hasDetectedBlogStep === false) return 'step1';

    const currentStep = displayStep ?? initialBlogStep ?? 'step1';
    const currentIdx = BLOG_STEP_IDS.indexOf(currentStep);
    if (currentIdx === -1) return 'step1';

    if (nextStepForPlaceholder) return nextStepForPlaceholder;

    const shouldAdvance =
      blogFlowStatus === 'waitingAction' || (blogFlowStatus === 'idle' && hasDetectedBlogStep);
    const nextIdx = shouldAdvance ? currentIdx + 1 : currentIdx;
    const targetIdx = Math.min(nextIdx, BLOG_STEP_IDS.length - 1);
    return BLOG_STEP_IDS[targetIdx] as BlogStepId;
  }, [hasDetectedBlogStep, displayStep, initialBlogStep, nextStepForPlaceholder, blogFlowStatus]);

  // ブログ作成のプレースホルダーは targetBlogStep と一致させる（送信モデルと同一）
  const placeholderMessage = (() => {
    if (!isModelSelected) {
      return '画面上部のチャットモデルを選択してください';
    }

    if (selectedModel === 'blog_creation') {
      const key = `blog_creation_${targetBlogStep}` as keyof typeof BLOG_PLACEHOLDERS;
      return BLOG_PLACEHOLDERS[key];
    }

    // 通常モデル
    return MODEL_PLACEHOLDERS[selectedModel] ?? 'チャットモデルを選択してください';
  })();
  const isStep5Visible = (displayStep ?? initialBlogStep) === 'step5';

  useEffect(() => {
    if (!isModelSelected) {
      setInput('');
    }
  }, [isModelSelected]);

  // ✅ セッション変更時に入力をクリア（モデル選択は外部から制御される）
  const prevSessionIdRef = useRef<string | undefined>(currentSessionId);
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

  // 既存チャットルームを開いた際、フロー状態から自動でブログ作成モデルに合わせる（モデル選択に依存しない）
  useEffect(() => {
    if (blogFlowStatus && blogFlowStatus !== 'idle' && selectedModel !== 'blog_creation') {
      setSelectedModel('blog_creation');
      onModelChange?.('blog_creation', initialBlogStep);
    }
  }, [blogFlowStatus, selectedModel, onModelChange, initialBlogStep]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isInputDisabled) return;

    const originalMessage = input.trim();
    // ブログ作成モデルの場合は、プレースホルダーと同じ targetBlogStep に送信する。
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
                  const targetStep: BlogStepId = initialBlogStep ?? 'step1';
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
              {...(displayStep !== undefined && { step: displayStep })}
              {...(hasDetectedBlogStep !== undefined && { hasDetectedBlogStep })}
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
              {...(onResetHeadingConfiguration !== undefined && { onResetHeadingConfiguration })}
              isLegacyStep6ResetEligible={isLegacyStep6ResetEligible}
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
                  {/* Step5表示中は手動保存導線を常に表示する */}
                  {isStep5Visible &&
                    onSaveManualStep5 &&
                    currentSessionId &&
                    input.trim() &&
                    !isReadOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSavingManualStep5 || isInputDisabled}
                        className="text-xs shrink-0"
                        onClick={async () => {
                          const content = input.trim();
                          if (!content || !onSaveManualStep5) return;
                          setIsSavingManualStep5(true);
                          try {
                            const result = await onSaveManualStep5(content);
                            if (result.success) {
                              setInput('');
                            } else {
                              setBlogArticleError(result.error ?? '保存に失敗しました');
                            }
                          } finally {
                            setIsSavingManualStep5(false);
                          }
                        }}
                      >
                        {isSavingManualStep5 ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          'この内容で保存'
                        )}
                      </Button>
                    )}
                  <Button
                    type="submit"
                    size="icon"
                    disabled={isInputDisabled || !input.trim()}
                    className="rounded-full size-10 bg-[#06c755] hover:bg-[#05b64b] mt-1"
                  >
                    <Send size={18} className="text-white" />
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
