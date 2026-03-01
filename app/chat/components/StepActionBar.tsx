'use client';
import React, { forwardRef, useImperativeHandle, useEffect, useState } from 'react';
import { BlogStepId, BLOG_STEP_HINTS, BLOG_STEP_LABELS, BLOG_STEP_IDS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import {
  BookMarked,
  BookOpen,
  FilePenLine,
  Loader2,
  RotateCw,
  SkipBack,
  SkipForward,
} from 'lucide-react';

interface StepActionBarProps {
  step?: BlogStepId;
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
  /** 見出し0件時に再初期化を試行（Step5保存後に手動復旧用） */
  onRetryHeadingInit?: () => void;
  /** Step6/Step7 本文生成時: 現在の見出しインデックス（0-based） */
  headingIndex?: number;
  /** Step6/Step7 本文生成時: 見出しの総数 */
  totalHeadings?: number;
  /** Step6/Step7 本文生成時: 現在の見出しテキスト */
  currentHeadingText?: string;
  /** 見出し構成をリセットしてStep5に戻る */
  onResetHeadingConfiguration?: () => Promise<void>;
  /** 旧step6データ（step7移行対象）かどうか */
  isLegacyStep6ResetEligible?: boolean;
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
      headingIndex,
      totalHeadings,
      currentHeadingText,
      onResetHeadingConfiguration,
      isLegacyStep6ResetEligible = false,
    },
    ref
  ) => {
    const actualStep = step ?? (BLOG_STEP_IDS[0] as BlogStepId);
    const actualIndex = BLOG_STEP_IDS.indexOf(actualStep);
    const displayIndex = actualIndex >= 0 ? actualIndex : 0;
    const displayStep = BLOG_STEP_IDS[displayIndex] ?? actualStep ?? BLOG_STEP_IDS[0];
    const nextStep = BLOG_STEP_IDS[displayIndex + 1] ?? null;

    // 再試行クリック時のみローディング表示。初回初期化中は警告を出さない。
    const [isRetrying, setIsRetrying] = useState(false);
    useEffect(() => {
      if (!isHeadingInitInFlight) setIsRetrying(false);
    }, [isHeadingInitInFlight]);

    useImperativeHandle(ref, () => ({
      getCurrentStepInfo: () => ({
        currentStep: displayStep,
        nextStep: nextStep ?? null,
      }),
    }));

    // UI制御
    const isStepReady =
      flowStatus === 'waitingAction' || (hasDetectedBlogStep && flowStatus === 'idle');
    const isDisabled = disabled || !isStepReady;
    const isStep6 = displayStep === 'step6';
    const isStep7 = displayStep === 'step7';
    const isStep1 = displayStep === 'step1';
    const isHeadingFlowStep = isStep7;
    const isHeadingFlowBusy = (isStep6 || isStep7) && (isSavingHeading || isHeadingInitInFlight);
    const isHeadingWarningStep = isStep7;
    const headingLabel =
      currentHeadingText && currentHeadingText.trim().length > 0
        ? currentHeadingText
        : '（見出し未設定）';

    // ラベル・ヒント
    const currentLabel = BLOG_STEP_LABELS[displayStep] ?? '';
    const nextStepLabel = nextStep ? BLOG_STEP_LABELS[nextStep]?.replace(/^\d+\.\s*/, '') : '';
    const hintText =
      BLOG_STEP_HINTS[displayStep] ??
      (nextStepLabel ? `次の${nextStepLabel}に進むにはメッセージを送信してください` : null);

    // ボタン表示制御
    const showLoadButton = isStep7 && typeof onLoadBlogArticle === 'function';
    const showTitleMetaButton =
      isStep7 && Boolean(hasStep7Content) && typeof onGenerateTitleMeta === 'function';
    const showSkipButton = !isStep7;
    const showBackButton = !isStep1;

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
      const shouldContinue =
        onBeforeManualStepChange?.({ direction, currentStep: displayStep, targetStep }) ?? true;
      if (!shouldContinue) {
        return;
      }
      onManualStepChange(targetStep);
    };

    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`}>
        <div className="text-xs px-3 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700">
          <span>
            現在のステップ: {currentLabel}
            {isHeadingFlowStep &&
              headingIndex !== undefined &&
              totalHeadings !== undefined &&
              totalHeadings > 0 && (
                <span className="ml-2 font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded border border-blue-300 animate-in fade-in slide-in-from-left-2 duration-300">
                  見出し {headingIndex + 1}/{totalHeadings}: 「{headingLabel}」
                </span>
              )}
            {isHeadingWarningStep &&
              totalHeadings === 0 &&
              (hasAttemptedHeadingInit || (isRetrying && isHeadingInitInFlight)) && (
                <span className="ml-2 inline-flex items-center gap-1.5">
                  {hasAttemptedHeadingInit && !isHeadingInitInFlight && (
                    <span className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                      見出しが見つかりません。メモ・補足情報の基本構成、またはステップ5の構成案に###/####形式で見出しを記載してください
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
                      title="メモ・補足情報の基本構成、またはステップ5を###/####形式で保存した後、ここで再試行"
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
            {hintText && (!isHeadingWarningStep || headingIndex === undefined) && (
              <span className="ml-1 opacity-80">／{hintText}</span>
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
          disabled={isDisabled || isHeadingFlowBusy || !onSaveClick || annotationLoading}
          size="sm"
          className="flex items-center gap-1 bg-black text-white hover:bg-black/90"
        >
          <BookMarked size={14} />
          <span>{annotationLoading ? '読み込み中...' : 'ブログ保存'}</span>
        </Button>
        {(isStep7 || (isStep6 && isLegacyStep6ResetEligible)) &&
          onResetHeadingConfiguration &&
          totalHeadings !== undefined &&
          totalHeadings > 0 && (
          <Button
            onClick={() => {
              const confirmMessage =
                '見出し構成と生成済みの本文（各見出しの中身）をすべてリセットします。※チャット履歴や書き出し案は保持されます。\n\nメモ・補足情報の基本構成、またはステップ5の構成案の内容から見出しの抽出・生成を最初からやり直しますか？';
              if (window.confirm(confirmMessage)) {
                void onResetHeadingConfiguration();
              }
            }}
            disabled={isDisabled || isHeadingFlowBusy}
            size="sm"
            variant="outline"
            title="メモ・補足情報の基本構成、またはステップ5の構成案からstep7見出し構成を再抽出します"
            className="flex items-center gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <RotateCw size={14} />
            <span>構成リセット</span>
          </Button>
        )}
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
