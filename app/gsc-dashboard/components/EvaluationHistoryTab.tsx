'use client';

import { useEffect, useState, useTransition } from 'react';
import { ChevronRight, Loader2, CheckCheck, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { markSuggestionAsRead } from '@/server/actions/gscNotification.actions';
import type { GscEvaluationHistoryItem } from '../types';
import { formatDateTime } from '@/lib/date-utils';
import { EvaluationResultAlert } from './evaluation-history/EvaluationResultAlert';
import {
  getEvaluationHistoryState,
} from './evaluation-history/evaluation-history-view';
import { SuggestionSections } from './evaluation-history/SuggestionSections';

interface EvaluationHistoryTabProps {
  history: GscEvaluationHistoryItem[] | undefined;
  onHistoryRead?: (historyId: string) => void;
}

export function EvaluationHistoryTab({
  history: initialHistory,
  onHistoryRead,
}: EvaluationHistoryTabProps) {
  const [history, setHistory] = useState(initialHistory);
  const [selectedHistory, setSelectedHistory] = useState<GscEvaluationHistoryItem | null>(null);
  const [isPending, startTransition] = useTransition();

  // 親からの最新履歴に同期（ローカルで既読にした状態を保持）
  useEffect(() => {
    setHistory(prev => {
      if (!initialHistory) return initialHistory;

      return initialHistory.map(item => {
        const localItem = prev?.find(p => p.id === item.id);
        // ローカルで既読にしている場合は、その状態を保持
        if (localItem && localItem.is_read && !item.is_read) {
          return { ...item, is_read: true };
        }
        return item;
      });
    });
  }, [initialHistory]);

  useEffect(() => {
    // 選択中の履歴がなくなった場合に閉じる
    if (selectedHistory && !initialHistory?.some(item => item.id === selectedHistory.id)) {
      setSelectedHistory(null);
    }
  }, [initialHistory, selectedHistory]);

  const handleMarkAsRead = (historyId: string) => {
    startTransition(async () => {
      const result = await markSuggestionAsRead(historyId);
      if (result.success) {
        // ローカル状態を更新
        setHistory(prev =>
          prev?.map(item => (item.id === historyId ? { ...item, is_read: true } : item))
        );
        // ダイアログ内の選択中アイテムも更新
        if (selectedHistory?.id === historyId) {
          setSelectedHistory(prev => (prev ? { ...prev, is_read: true } : null));
        }
        onHistoryRead?.(historyId);
      } else {
        toast.error(result.error || '既読処理に失敗しました');
      }
    });
  };

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardContent className="py-20 text-center text-gray-500">
          <p>まだ評価履歴がありません</p>
          <p className="text-sm mt-2">概要タブから評価サイクルを開始してください</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {history.map(item => {
              const viewState = getEvaluationHistoryState(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`group p-4 rounded-lg border flex items-center justify-between shadow-sm cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all duration-200 ${
                    viewState.isError
                      ? 'bg-red-50 border-red-200 hover:bg-red-100'
                      : 'bg-white hover:bg-gray-50'
                  } w-full text-left`}
                  onClick={() => setSelectedHistory(item)}
                >
                  <div className="flex items-center gap-3">
                    {viewState.isError && <AlertCircle className="w-5 h-5 text-red-500" />}
                    {viewState.showUnreadBadge && (
                      <span className="flex h-2 w-2 rounded-full bg-amber-500" title="未読" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {formatDateTime(item.created_at)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">
                          {viewState.isError ? 'エラー:' : '判定:'}
                        </span>
                        <span className={viewState.statusClassName}>{viewState.statusLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {!viewState.isError && !viewState.isNoMetrics && (
                      <div className="text-right">
                        <div className="flex items-baseline gap-2 justify-end">
                          <span className="text-xs text-gray-500">
                            前回: {item.previous_position ?? '—'}
                          </span>
                          <span className="text-gray-400">→</span>
                          <span className="text-lg font-bold text-gray-900">
                            {item.current_position ?? '—'}
                          </span>
                          {item.current_position !== null && (
                            <span className="text-xs text-gray-500">位</span>
                          )}
                        </div>
                      </div>
                    )}
                    <ChevronRight
                      className={`w-5 h-5 transition-all duration-200 ${
                        viewState.isError
                          ? 'text-red-400 group-hover:text-red-600'
                          : 'text-gray-400 group-hover:text-blue-600'
                      } group-hover:translate-x-1`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* 評価履歴詳細Dialog */}
      <Dialog
        open={selectedHistory !== null}
        onOpenChange={open => !open && setSelectedHistory(null)}
      >
        <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AIの改善提案内容</DialogTitle>
          </DialogHeader>
          {selectedHistory && (
            <div className="space-y-4">
              {selectedHistory.outcomeType === 'error' &&
              selectedHistory.errorCode !== 'no_metrics' ? (
                <EvaluationResultAlert
                  variant="error"
                  errorCode={selectedHistory.errorCode}
                  errorMessage={selectedHistory.errorMessage}
                  createdAt={selectedHistory.created_at}
                />
              ) : selectedHistory.outcomeType === 'error' &&
                selectedHistory.errorCode === 'no_metrics' ? (
                <EvaluationResultAlert
                  variant="no_metrics"
                  errorCode={selectedHistory.errorCode}
                  errorMessage={selectedHistory.errorMessage}
                  createdAt={selectedHistory.created_at}
                />
              ) : (
                // 成功時の表示（既存）
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">評価日</p>
                    <p className="text-sm font-medium">
                      {formatDateTime(selectedHistory.created_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">判定</p>
                    <span className={getEvaluationHistoryState(selectedHistory).statusClassName}>
                      {getEvaluationHistoryState(selectedHistory).statusLabel}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">前回順位</p>
                    <p className="text-sm font-medium">
                      {selectedHistory.previous_position ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">現在順位</p>
                    <p className="text-sm font-medium">
                      {selectedHistory.current_position ?? '—'}
                      {selectedHistory.current_position !== null && '位'}
                    </p>
                  </div>
                </div>
              )}
              {selectedHistory.outcomeType !== 'error' && (
                <div>
                  <p className="text-sm font-semibold mb-2">改善提案</p>
                  {selectedHistory.suggestion_summary ? (
                    <SuggestionSections summary={selectedHistory.suggestion_summary} />
                  ) : (
                    <p className="text-sm text-gray-500 italic">提案なし</p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {selectedHistory &&
              getEvaluationHistoryState(selectedHistory).canMarkAsRead &&
              !selectedHistory.is_read && (
                <Button
                  onClick={() => handleMarkAsRead(selectedHistory.id)}
                  disabled={isPending}
                  className="gap-2"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  既読にする
                </Button>
              )}
            {selectedHistory?.is_read && (
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <CheckCheck className="h-4 w-4" />
                既読済み
              </span>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
