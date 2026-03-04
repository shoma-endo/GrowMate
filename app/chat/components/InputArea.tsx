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
  hasStep7Content?: boolean;
  onGenerateTitleMeta?: () => void;
  isGenerateTitleMetaLoading?: boolean;
  stepActionBarDisabled?: boolean;
  onNextStepChange?: (nextStep: BlogStepId | null) => void;
  onLoadBlogArticle?: (() => Promise<void>) | undefined;
  onManualStepChange?: (step: BlogStepId) => void;
  searchQuery: string;
  searchError: string | null;
  isSearching: boolean;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  // Service selector props
  services?: Service[];
  selectedServiceId?: string | null;
  onServiceChange?: (serviceId: string) => void;
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
  hasStep7Content,
  onGenerateTitleMeta,
  isGenerateTitleMetaLoading,
  stepActionBarDisabled,
  onNextStepChange,
  onLoadBlogArticle,
  onManualStepChange,
  searchQuery,
  searchError,
  isSearching,
  onSearch,
  onClearSearch,
  services,
  selectedServiceId,
  onServiceChange,
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
  const isInputDisabled = disabled || !isModelSelected || isReadOnly;
  const isStepActionBarDisabled = Boolean(stepActionBarDisabled || isReadOnly);

  // ブログ作成中は「次に進む」タイミングでは次ステップのプレースホルダーを表示
  const placeholderMessage = (() => {
    if (!isModelSelected) {
      return '画面上部のチャットモデルを選択してください';
    }

    if (selectedModel === 'blog_creation') {
      // ブログ作成を開始していない場合（hasDetectedBlogStep === false）はstep1を表示
      if (!hasDetectedBlogStep) {
        return BLOG_PLACEHOLDERS.blog_creation_step1;
      }

      // nextStepForPlaceholderが設定されている場合はそれを使用（StepActionBarのnextStepと連動）
      // ブログ作成進行中（hasDetectedBlogStep === true）の場合のみ適用
      if (nextStepForPlaceholder) {
        const key = `blog_creation_${nextStepForPlaceholder}` as keyof typeof BLOG_PLACEHOLDERS;
        return BLOG_PLACEHOLDERS[key];
      }

      // フォールバック: 次のステップのプレースホルダーを表示
      // - waitingActionまたはhasDetectedBlogStep時は次のステップへ
      // - それ以外は現在のステップ
      const currentStep = initialBlogStep ?? 'step1';
      const currentIdx = BLOG_STEP_IDS.indexOf(currentStep);
      const shouldAdvance = hasDetectedBlogStep; // すでにブログ作成が始まっている場合は次へ
      const nextIdx = shouldAdvance ? currentIdx + 1 : currentIdx;
      const targetIdx = Math.min(nextIdx, BLOG_STEP_IDS.length - 1);
      const fallbackStep = BLOG_STEP_IDS[targetIdx] as BlogStepId;
      const key = `blog_creation_${fallbackStep}` as keyof typeof BLOG_PLACEHOLDERS;
      return BLOG_PLACEHOLDERS[key];
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
      const message =
        error instanceof Error ? error.message : 'ブログ記事の取得に失敗しました';
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
    // ブログ作成モデルの場合の制御：
    // - アクション待ち（waitingAction）での通常送信は「次のステップへ進む」扱い
    let effectiveModel: string = selectedModel;
    if (selectedModel === 'blog_creation') {
      // 通常送信は次ステップへ（初回はstep1）
      const currentStep = initialBlogStep ?? 'step1';
      const currentIdx = BLOG_STEP_IDS.indexOf(currentStep);

      // 型定義上はありえないが、実行時の安全性のため念のためチェック
      if (currentIdx === -1) {
        console.error(
          `[InputArea] initialBlogStep is invalid: ${currentStep}. Falling back to step1.`
        );
        const fallbackStep = 'step1';
        effectiveModel = `blog_creation_${fallbackStep}`;
        onModelChange?.('blog_creation', fallbackStep);
      } else {
        const shouldAdvance =
          blogFlowStatus === 'waitingAction' ||
          (blogFlowStatus === 'idle' && hasDetectedBlogStep);

        // 次のステップのインデックスを計算（現在のステップまたは次のステップ）
        const nextIdx = shouldAdvance ? currentIdx + 1 : currentIdx;
        // 配列範囲内に収める（最後のステップを超えない）
        const targetIdx = Math.min(nextIdx, BLOG_STEP_IDS.length - 1);
        const targetStep = BLOG_STEP_IDS[targetIdx] as BlogStepId;

        effectiveModel = `blog_creation_${targetStep}`;
        onModelChange?.('blog_creation', targetStep);
      }
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
              step={displayStep}
              hasDetectedBlogStep={hasDetectedBlogStep}
              className="flex-wrap gap-3"
              disabled={isStepActionBarDisabled}
              onSaveClick={onSaveClick}
              annotationLoading={annotationLoading}
              hasStep7Content={hasStep7Content}
              onGenerateTitleMeta={onGenerateTitleMeta}
              isGenerateTitleMetaLoading={isGenerateTitleMetaLoading}
              onNextStepChange={onNextStepChange}
              flowStatus={blogFlowStatus}
              onLoadBlogArticle={handleLoadBlogArticle}
              isLoadBlogArticleLoading={isLoadingBlogArticle}
              onManualStepChange={onManualStepChange}
            />
            {blogArticleError && (
              <p className="mt-2 text-xs text-red-500">{blogArticleError}</p>
            )}
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
                <div className="flex gap-1">
                  <Button
                    type="submit"
                    size="icon"
                    disabled={
                      isInputDisabled ||
                      !input.trim()
                    }
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
