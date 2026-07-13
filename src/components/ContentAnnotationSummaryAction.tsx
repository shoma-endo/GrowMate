'use client';

import { useState } from 'react';
import { Info, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import { summarizeContentAnnotation } from '@/server/actions/contentAnnotationSummary.actions';
import type { AnnotationRecord } from '@/types/annotation';

interface ContentAnnotationSummaryActionProps {
  sessionId?: string | null;
  isWordPressLinked: boolean;
  disabled?: boolean;
  size?: 'sm' | 'default';
  onSuccess: (data: AnnotationRecord) => void | Promise<void>;
  onError?: (message: string) => void;
  onPendingChange?: (isPending: boolean) => void;
}

export default function ContentAnnotationSummaryAction({
  sessionId,
  isWordPressLinked,
  disabled = false,
  size = 'sm',
  onSuccess,
  onError,
  onPendingChange,
}: ContentAnnotationSummaryActionProps) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const canSummarize = Boolean(sessionId) && isWordPressLinked;

  const handleSummarize = async () => {
    if (!sessionId || !canSummarize || disabled || isSummarizing) {
      return;
    }

    setIsSummarizing(true);
    onPendingChange?.(true);
    onError?.('');
    const toastId = toast.loading('WordPress本文を要約しています...');

    try {
      const result = await summarizeContentAnnotation(sessionId);
      if (isEmailLinkConflictResult(result)) {
        toast.dismiss(toastId);
        replaceToEmailLinkConflictLogin();
        return;
      }
      if (!result.success) {
        const message = result.error || 'AI要約の生成に失敗しました';
        toast.error(message, { id: toastId });
        onError?.(message);
        return;
      }

      await onSuccess(result.data);
      toast.success('AIによる要約でフィールドを更新しました', { id: toastId });
    } catch (error) {
      console.error('[ContentAnnotationSummaryAction] summarize failed:', error);
      const message = '要約処理中にエラーが発生しました';
      toast.error(message, { id: toastId });
      onError?.(message);
    } finally {
      setIsSummarizing(false);
      onPendingChange?.(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size={size}
          onClick={handleSummarize}
          disabled={!canSummarize || disabled || isSummarizing}
          className="min-h-9 border-purple-200 bg-purple-50 text-purple-900 hover:bg-purple-100 hover:text-purple-900"
        >
          {isSummarizing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              要約中…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              AIで要約
            </>
          )}
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="AI要約による上書きについて"
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] text-xs">
              <p>
                WordPress本文から生成し直します。現在入力中の未保存内容も含めて上書きされます。
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {!canSummarize && (
        <span className="text-xs text-muted-foreground">
          WordPress連携済みのコンテンツで利用できます
        </span>
      )}
    </div>
  );
}
