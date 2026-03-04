'use client';
import React, { forwardRef, useImperativeHandle, useEffect } from 'react';
import { BlogStepId, BLOG_STEP_LABELS, BLOG_STEP_IDS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { BookMarked, BookOpen, FilePenLine, Loader2, SkipBack, SkipForward } from 'lucide-react';

interface StepActionBarProps {
  step?: BlogStepId | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  hasDetectedBlogStep?: boolean | undefined;
  onSaveClick?: (() => void) | undefined;
  annotationLoading?: boolean | undefined;
  hasStep7Content?: boolean | undefined;
  onGenerateTitleMeta?: (() => void) | undefined;
  isGenerateTitleMetaLoading?: boolean | undefined;
  onNextStepChange?: ((nextStep: BlogStepId | null) => void) | undefined;
  flowStatus?: string | undefined;
  onLoadBlogArticle?: (() => Promise<void>) | undefined;
  isLoadBlogArticleLoading?: boolean;
  onManualStepChange?: ((step: BlogStepId) => void) | undefined;
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
      hasDetectedBlogStep,
      onSaveClick,
      annotationLoading,
      hasStep7Content,
      onGenerateTitleMeta,
      isGenerateTitleMetaLoading = false,
      onNextStepChange,
      flowStatus = 'idle',
      onLoadBlogArticle,
      isLoadBlogArticleLoading = false,
      onManualStepChange,
    },
    ref
  ) => {
    const actualStep = step ?? (BLOG_STEP_IDS[0] as BlogStepId);
    const actualIndex = BLOG_STEP_IDS.indexOf(actualStep);
    const displayIndex = actualIndex >= 0 ? actualIndex : 0;
    const displayStep = BLOG_STEP_IDS[displayIndex] ?? actualStep ?? BLOG_STEP_IDS[0];
    const nextStep = BLOG_STEP_IDS[displayIndex + 1] ?? null;

    useImperativeHandle(ref, () => ({
      getCurrentStepInfo: () => ({
        currentStep: displayStep,
        nextStep: nextStep ?? null,
      }),
    }));

    // UI制御
    const isStepReady = flowStatus === 'waitingAction' || (hasDetectedBlogStep && flowStatus === 'idle');
    const isDisabled = disabled || !isStepReady;
    const isStep7 = displayStep === 'step7';
    const isStep1 = displayStep === 'step1';
    const showLoadButton = isStep7 && typeof onLoadBlogArticle === 'function';
    const showTitleMetaButton =
      isStep7 && Boolean(hasStep7Content) && typeof onGenerateTitleMeta === 'function';
    const showSkipButton = !isStep7;
    const showBackButton = !isStep1;

    // ラベル
    const currentLabel = BLOG_STEP_LABELS[displayStep] ?? '';
    const nextStepLabel = nextStep ? BLOG_STEP_LABELS[nextStep]?.replace(/^\d+\.\s*/, '') : '';

    // nextStep の変更を親コンポーネントに通知
    useEffect(() => {
      onNextStepChange?.(nextStep);
    }, [nextStep, onNextStepChange]);

    const handleManualStepShift = (direction: 'forward' | 'backward') => {
      if (!onManualStepChange) {
        return;
      }
      const targetIndex = direction === 'forward' ? displayIndex + 1 : displayIndex - 1;
      const targetStep = BLOG_STEP_IDS[targetIndex];
      if (!targetStep) {
        return;
      }
      onManualStepChange(targetStep);
    };

    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <div className="text-xs px-3 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700">
          <span>
            現在のステップ: {currentLabel}
            {nextStepLabel ? ` ／ 次の${nextStepLabel}に進むにはメッセージを送信してください` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showBackButton && (
            <Button
              type="button"
              onClick={() => handleManualStepShift('backward')}
              disabled={isDisabled || !onManualStepChange}
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
              disabled={isDisabled || !onManualStepChange}
              size="sm"
              className="flex items-center gap-1 bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-emerald-300"
            >
              <SkipForward size={14} />
              スキップ
            </Button>
          )}
        </div>
        {showLoadButton && (
          <Button
            onClick={() => {
              if (isDisabled || isLoadBlogArticleLoading) return;
              void onLoadBlogArticle?.();
            }}
            disabled={isDisabled || isLoadBlogArticleLoading}
            size="sm"
            variant="outline"
            className="flex items-center gap-1 bg-white text-gray-900 hover:bg-gray-100"
          >
            {isLoadBlogArticleLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BookOpen size={14} />
            )}
            <span>{isLoadBlogArticleLoading ? '取得中…' : 'ブログ記事取得'}</span>
          </Button>
        )}
        <Button
          onClick={() => onSaveClick?.()}
          disabled={isDisabled || !onSaveClick || annotationLoading}
          size="sm"
          className="flex items-center gap-1 bg-black text-white hover:bg-black/90"
        >
          <BookMarked size={14} />
          <span>{annotationLoading ? '読み込み中...' : 'ブログ保存'}</span>
        </Button>
        {showTitleMetaButton && (
          <Button
            onClick={() => onGenerateTitleMeta?.()}
            disabled={isDisabled || !onGenerateTitleMeta || isGenerateTitleMetaLoading}
            size="sm"
            variant="outline"
            className="flex items-center gap-1 bg-purple-50 text-purple-900 border-purple-200 hover:bg-purple-100"
          >
            {isGenerateTitleMetaLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FilePenLine size={14} />
            )}
            <span>{isGenerateTitleMetaLoading ? '生成中…' : 'タイトル・説明文生成'}</span>
          </Button>
        )}
      </div>
    );
  }
);

StepActionBar.displayName = 'StepActionBar';

export default StepActionBar;
