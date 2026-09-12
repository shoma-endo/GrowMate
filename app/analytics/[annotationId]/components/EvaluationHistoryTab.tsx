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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { markSuggestionAsRead } from '@/server/actions/gscNotification.actions';
import { saveEvaluationHistoryMemo } from '@/server/actions/gscDashboard.actions';
import type { GscEvaluationHistoryItem } from '../types';
import { formatDateTime } from '@/lib/date-utils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { EvaluationResultAlert } from './evaluation-history/EvaluationResultAlert';
import {
  getEvaluationHistoryState,
  getSuggestionStatusMessage,
} from './evaluation-history/evaluation-history-view';
import { SuggestionSections } from './evaluation-history/SuggestionSections';

interface EvaluationHistoryTabProps {
  history: GscEvaluationHistoryItem[] | undefined;
  onHistoryRead?: (historyId: string) => void;
  onHistoryMemoSaved?: (historyId: string, memo: string | null) => void;
}

export function EvaluationHistoryTab({
  history: initialHistory,
  onHistoryRead,
  onHistoryMemoSaved,
}: EvaluationHistoryTabProps) {
  const [history, setHistory] = useState(initialHistory);
  const [selectedHistory, setSelectedHistory] = useState<GscEvaluationHistoryItem | null>(null);
  const [memoDraft, setMemoDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isSavingMemo, startSavingMemo] = useTransition();

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

  const handleSaveMemo = () => {
    if (!selectedHistory) return;

    const historyId = selectedHistory.id;
    startSavingMemo(async () => {
      try {
        const result = await saveEvaluationHistoryMemo(historyId, memoDraft);
        if (!result.success) {
          toast.error(result.error);
          return;
        }

        setHistory(prev =>
          prev?.map(item => (item.id === historyId ? { ...item, memo: result.data.memo } : item))
        );
        setSelectedHistory(prev =>
          prev && prev.id === historyId ? { ...prev, memo: result.data.memo } : prev
        );
        onHistoryMemoSaved?.(historyId, result.data.memo);
        toast.success('メモを保存しました');
      } catch (error) {
        console.error('[EvaluationHistoryTab] save memo failed', error);
        toast.error(ERROR_MESSAGES.GSC.EVALUATION_MEMO_SAVE_FAILED);
      }
    });
  };

  if (!history || history.length === 0) {
    return <Card><CardContent className="py-20 text-center text-gray-500"><p>まだ検索順位評価履歴がありません</p><p className="text-sm mt-2">概要タブの「検索順位・コンテンツ評価サイクル設定」で評価サイクルを設定すると、履歴がここに表示されます</p></CardContent></Card>;
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
                  onClick={() => {
                    setSelectedHistory(item);
                    setMemoDraft(item.memo ?? '');
                  }}
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
                    (() => {
                      const status = getSuggestionStatusMessage(selectedHistory);
                      return status ? (
                        <Alert variant={status.variant}>
                          <AlertTitle>{status.title}</AlertTitle>
                          <AlertDescription>{status.description}</AlertDescription>
                        </Alert>
                      ) : (
                        <p className="text-sm text-gray-500 italic">提案なし</p>
                      );
                    })()
                  )}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold mb-2">評価と改善提案の進み方</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                  <li>
                    評価は、設定した評価サイクル（初期設定は30日）ごとに自動で行われます。「今すぐ評価を実行」を押したときも同じように評価されます。
                  </li>
                  <li>評価では、前回の評価時と今回の検索順位を比べます。</li>
                  <li>
                    順位が上がった場合: 改善提案は届かず、次の提案は1段階目からやり直します。
                  </li>
                  <li>
                    順位が変わらない・下がった場合: 改善提案が届き、次の評価では1段階先の提案に進みます（4段階目で止まります）。
                  </li>
                  <li>
                    提案の段階: 1 タイトル・説明文の提案 → 2 書き出し案の提案 → 3 本文の提案 → 4 ペルソナから全て変更。2段階目以降は、それまでの段階の提案もあわせて表示されます。
                  </li>
                  <li>
                    最初の評価は、比べる基準となる順位を記録するだけで、改善提案は届きません。
                  </li>
                  <li>順位のデータを取得できなかった回は、段階は進みません。</li>
                  <li>
                    「既読にする」は通知を消すだけで、段階の進み方には影響しません。
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <Label htmlFor="evaluation-history-memo">この評価のメモ</Label>
                <Textarea
                  id="evaluation-history-memo"
                  value={memoDraft}
                  onChange={event => setMemoDraft(event.target.value)}
                />
                <Button
                  type="button"
                  onClick={handleSaveMemo}
                  disabled={isSavingMemo}
                  className="gap-2"
                >
                  {isSavingMemo && <Loader2 className="h-4 w-4 animate-spin" />}
                  保存
                </Button>
              </div>
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
