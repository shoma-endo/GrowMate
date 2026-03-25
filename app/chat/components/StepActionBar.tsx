'use client';
import React, { forwardRef, useImperativeHandle, useEffect, useState } from 'react';
import { BlogStepId, BLOG_STEP_IDS, BLOG_STEP_ACTION_BAR_FULL_TEXT } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  BookOpen,
  FilePenLine,
  FileText,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCw,
  Save,
  SkipBack,
  SkipForward,
} from 'lucide-react';

interface StepActionBarProps {
  step?: BlogStepId;
  /** スキップ/バックの遷移計算用。未指定時は step を使用 */
  stepForNavigation?: BlogStepId;
  className?: string;
  disabled?: boolean;
  hasDetectedBlogStep?: boolean;
  onSaveClick?: () => void;
  annotationLoading?: boolean;
  isSavingHeading?: boolean;
  hasStep7Content?: boolean;
  onGenerateTitleMeta?: () => void;
  isGenerateTitleMetaLoading?: boolean;
  onNextStepChange?: (nextStep: BlogStepId | null) => void;
  flowStatus?: string;
  onLoadBlogArticle?: () => Promise<void>;
  isLoadBlogArticleLoading?: boolean;
  onManualStepChange?: (step: BlogStepId) => void;
  onBeforeManualStepChange?: (params: {
    direction: 'forward' | 'backward';
    currentStep: BlogStepId;
    targetStep: BlogStepId;
  }) => boolean;
  isHeadingInitInFlight?: boolean;
  hasAttemptedHeadingInit?: boolean;
  /** 見出し0件時に再初期化を試行（基本構成保存後に手動復旧用） */
  onRetryHeadingInit?: () => void;
  /** Step6/Step7 本文生成時: 現在の見出しインデックス（0-based） */
  headingIndex?: number;
  /** Step6/Step7 本文生成時: 見出しの総数 */
  totalHeadings?: number;
  /** Step6/Step7 本文生成時: 現在の見出しテキスト */
  currentHeadingText?: string;
  /** Step7 見出し生成: 現在生成対象の見出しインデックス（0-based）。undefined = 全確定・完成形フェーズ */
  activeHeadingIndex?: number;
  /** Step7 見出し生成: 保存ボタン無効化（コンテンツ未生成時 true） */
  isStep7SaveDisabled?: boolean;
  /** Step7 見出し生成: 見出し生成トリガー */
  onStartHeadingGeneration?: (headingIndex: number) => void;
  /** Step7 見出し保存: 保存して次へ */
  onSaveHeadingSection?: () => Promise<void>;
  /** Step7 全見出し保存後: 結合のみ実行（本文生成ボタン用） */
  onBuildCombinedOnly?: () => Promise<void>;
  /** 見出し生成中・チャットローディング中 */
  isChatLoading?: boolean;
  /** 本文生成（完成形構築）中 */
  isBuildingCombined?: boolean;
  /** 次ステップ（親で算出済みの場合は ref の nextStep に使用） */
  nextStepForSend?: BlogStepId;
}

export interface StepActionBarRef {
  getCurrentStepInfo: () => { currentStep: BlogStepId; nextStep: BlogStepId | null };
}

const StepActionBar = forwardRef<StepActionBarRef, StepActionBarProps>(
  (
    {
      className,
      disabled,
      step,
      stepForNavigation,
      hasDetectedBlogStep,
      onSaveClick,
      annotationLoading,
      isSavingHeading = false,
      hasStep7Content,
      onGenerateTitleMeta,
      isGenerateTitleMetaLoading = false,
      onNextStepChange,
      flowStatus = 'idle',
      onLoadBlogArticle,
      isLoadBlogArticleLoading = false,
      onManualStepChange,
      onBeforeManualStepChange,
      isHeadingInitInFlight = false,
      hasAttemptedHeadingInit = false,
      onRetryHeadingInit,
      totalHeadings,
      currentHeadingText,
      activeHeadingIndex,
      isStep7SaveDisabled = true,
      onStartHeadingGeneration,
      onSaveHeadingSection,
      onBuildCombinedOnly,
      isChatLoading = false,
      isBuildingCombined = false,
      nextStepForSend,
    },
    ref
  ) => {
    const actualStep = step ?? (BLOG_STEP_IDS[0] as BlogStepId);
    const actualIndex = BLOG_STEP_IDS.indexOf(actualStep);
    const displayIndex = actualIndex >= 0 ? actualIndex : 0;
    const displayStep = BLOG_STEP_IDS[displayIndex] ?? actualStep ?? BLOG_STEP_IDS[0];
    const nextStepFallback = BLOG_STEP_IDS[displayIndex + 1] ?? null;

    // 再試行クリック時のみローディング表示。初回初期化中は警告を出さない。
    const [isRetrying, setIsRetrying] = useState(false);
    useEffect(() => {
      if (!isHeadingInitInFlight) setIsRetrying(false);
    }, [isHeadingInitInFlight]);

    useImperativeHandle(ref, () => ({
      getCurrentStepInfo: () => ({
        currentStep: displayStep,
        nextStep: nextStepForSend ?? nextStepFallback ?? null,
      }),
    }));

    // UI制御
    const isStepReady =
      flowStatus === 'waitingAction' || (hasDetectedBlogStep && flowStatus === 'idle');
    const isDisabled = disabled || !isStepReady;
    const isStep6 = displayStep === 'step6';
    const isStep7 = displayStep === 'step7';
    const isStep1 = displayStep === 'step1';
    const isHeadingFlowBusy = (isStep6 || isStep7) && (isSavingHeading || isHeadingInitInFlight || isBuildingCombined);

    // 「現在のステップ」表示（定数で完全固定。step7 は見出しフェーズで動的追記あり）
    const stepDisplayText = BLOG_STEP_ACTION_BAR_FULL_TEXT[displayStep] ?? '';

    // ボタン表示制御
    const showLoadButton = isStep7 && typeof onLoadBlogArticle === 'function';
    const showTitleMetaButton =
      isStep7 && Boolean(hasStep7Content) && typeof onGenerateTitleMeta === 'function';
    const showSkipButton = !isStep7;
    const showBackButton = !isStep1;

    // Step7 見出し生成フェーズ: 見出し生成・保存ボタン
    const isStep7HeadingPhase =
      isStep7 &&
      totalHeadings !== undefined &&
      totalHeadings > 0 &&
      activeHeadingIndex !== undefined;
    // Step7 全見出し保存後（完成形フェーズ）: 本文生成ボタンのみ
    const isStep7AllSavedPhase =
      isStep7 &&
      totalHeadings !== undefined &&
      totalHeadings > 0 &&
      activeHeadingIndex === undefined;
    const showHeadingGenerateButton =
      isStep7HeadingPhase && isStep7SaveDisabled && Boolean(onStartHeadingGeneration);
    const showLastHeadingBuildButton =
      isStep7AllSavedPhase && Boolean(onBuildCombinedOnly);
    const showHeadingSaveButton =
      isStep7HeadingPhase &&
      !isStep7SaveDisabled &&
      Boolean(onSaveHeadingSection);
    const isStep7HeadingBusy = isSavingHeading || isChatLoading || isBuildingCombined;

    // 次ステップの変更を親コンポーネントに通知
    const effectiveNextStep = nextStepForSend ?? nextStepFallback;
    useEffect(() => {
      onNextStepChange?.(effectiveNextStep);
    }, [effectiveNextStep, onNextStepChange]);

    const handleManualStepShift = (direction: 'forward' | 'backward') => {
      if (!onManualStepChange) {
        return;
      }
      const navStep = stepForNavigation ?? step ?? (BLOG_STEP_IDS[0] as BlogStepId);
      const navIndex = BLOG_STEP_IDS.indexOf(navStep);
      const navIdx = navIndex >= 0 ? navIndex : 0;
      const targetIndex = direction === 'forward' ? navIdx + 1 : navIdx - 1;
      const targetStep = BLOG_STEP_IDS[targetIndex];
      if (!targetStep) {
        return;
      }
      const shouldContinue =
        onBeforeManualStepChange?.({ direction, currentStep: navStep, targetStep }) ?? true;
      if (!shouldContinue) {
        return;
      }
      onManualStepChange(targetStep);
    };

    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <div className="text-xs px-3 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700">
          <span>
            {stepDisplayText}
            {isStep7 &&
              totalHeadings !== undefined &&
              totalHeadings > 0 &&
              activeHeadingIndex !== undefined && (
                <span className="ml-2">
                  見出し {activeHeadingIndex + 1}/{totalHeadings}
                  {currentHeadingText && (
                    <span className="ml-1.5 text-blue-600" title={currentHeadingText}>
                      | {currentHeadingText.length > 20 ? `${currentHeadingText.slice(0, 20)}…` : currentHeadingText}
                    </span>
                  )}
                </span>
              )}
            {isStep7 &&
              totalHeadings === 0 &&
              (hasAttemptedHeadingInit || isRetrying) && (
                <span className="ml-2 inline-flex items-center gap-1.5">
                  {hasAttemptedHeadingInit && !isHeadingInitInFlight && (
                    <span className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                      見出しが見つかりません。メモ・補足情報の「基本構成」に ###/#### 形式で見出しを記載してください
                    </span>
                  )}
                  {onRetryHeadingInit && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (isRetrying || isHeadingInitInFlight) return;
                        setIsRetrying(true);
                        onRetryHeadingInit();
                      }}
                      disabled={isHeadingInitInFlight}
                      className="h-6 px-2 text-[10px] border-amber-300 text-amber-800 hover:bg-amber-50"
                      title="メモ・補足情報の「基本構成」を ###/#### 形式で保存した後、ここで再試行"
                    >
                      {isHeadingInitInFlight ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <RotateCw size={10} className="mr-0.5" />
                      )}
                      再試行
                    </Button>
                  )}
                </span>
              )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showBackButton && (
            <Button
              type="button"
              onClick={() => handleManualStepShift('backward')}
              disabled={isDisabled || isHeadingFlowBusy || !onManualStepChange}
              size="sm"
              className="flex items-center gap-1 bg-slate-600 text-white hover:bg-slate-700 disabled:bg-slate-400"
            >
              <SkipBack size={14} />
              バック
            </Button>
          )}
          {showSkipButton && (
            <Button
              type="button"
              onClick={() => handleManualStepShift('forward')}
              disabled={isDisabled || isHeadingFlowBusy || !onManualStepChange}
              size="sm"
              className="flex items-center gap-1 bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-emerald-300"
            >
              <SkipForward size={14} />
              スキップ
            </Button>
          )}
        </div>
        {showHeadingGenerateButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onStartHeadingGeneration?.(activeHeadingIndex!)}
                  disabled={isDisabled || isStep7HeadingBusy}
                  className="flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-400"
                >
                  {isStep7HeadingBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  <span>見出し生成</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>現在の見出しの本文を生成します</p>
            </TooltipContent>
          </Tooltip>
        )}
        {showLastHeadingBuildButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onBuildCombinedOnly?.()}
                  disabled={isDisabled || isStep7HeadingBusy}
                  className="flex items-center gap-1 bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400"
                >
                  {(isSavingHeading || isBuildingCombined) ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FileText size={14} />
                  )}
                  <span>{isBuildingCombined ? '生成中...' : '本文生成'}</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>保存した全見出しを結合して本文を作成します</p>
            </TooltipContent>
          </Tooltip>
        )}
        {showHeadingSaveButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onSaveHeadingSection?.()}
                  disabled={isDisabled || isStep7HeadingBusy}
                  className="flex items-center gap-1 bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400"
                >
                  {isSavingHeading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  <span>見出し保存</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>この見出しを保存して次に進みます</p>
            </TooltipContent>
          </Tooltip>
        )}
        <Button
          onClick={() => onSaveClick?.()}
          disabled={isDisabled || isHeadingFlowBusy || !onSaveClick || annotationLoading}
          size="sm"
          className="flex items-center gap-1 bg-black text-white hover:bg-black/90"
        >
          <Save size={14} />
          <span>{annotationLoading ? '読み込み中...' : 'ブログ保存'}</span>
        </Button>
        {isStep7 && (showLoadButton || showTitleMetaButton) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDisabled || isHeadingFlowBusy}
                className="flex items-center gap-1 px-2.5"
                title="その他の操作"
                aria-label="その他の操作"
              >
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="min-w-[200px]">
              {showTitleMetaButton && (
                <DropdownMenuItem
                  disabled={isDisabled || !onGenerateTitleMeta || isGenerateTitleMetaLoading}
                  onSelect={() => onGenerateTitleMeta?.()}
                  className="flex items-center gap-1 bg-purple-50 text-purple-900 border border-purple-200 hover:bg-purple-100 data-[highlighted]:bg-purple-100"
                >
                  {isGenerateTitleMetaLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FilePenLine size={14} />
                  )}
                  <span>
                    {isGenerateTitleMetaLoading ? '生成中…' : 'タイトル・説明文生成'}
                  </span>
                </DropdownMenuItem>
              )}
              {showLoadButton && (
                <DropdownMenuItem
                  disabled={isDisabled || isLoadBlogArticleLoading}
                  onSelect={() => {
                    if (isDisabled || isLoadBlogArticleLoading) return;
                    void onLoadBlogArticle?.();
                  }}
                  className="flex items-center gap-1 bg-white text-gray-900 hover:bg-gray-100 data-[highlighted]:bg-gray-100"
                >
                  {isLoadBlogArticleLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <BookOpen size={14} />
                  )}
                  <span>{isLoadBlogArticleLoading ? '取得中…' : 'ブログ記事取得'}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }
);

StepActionBar.displayName = 'StepActionBar';

export default StepActionBar;
