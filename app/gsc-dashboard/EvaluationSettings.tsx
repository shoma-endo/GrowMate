'use client';

import { useState, useEffect } from 'react';
import { Loader2, Info, Calendar as CalendarIcon, Settings, Save, Clock, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useLiffContext } from '@/components/LiffProvider';
import type { EvaluationResultSummary } from '@/types/gsc';

// 時間選択用の選択肢を生成
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i.toString(),
  label: `${i.toString().padStart(2, '0')}:00`,
}));

interface EvaluationSettingsProps {
  currentEvaluation: {
    base_evaluation_date: string;
    last_evaluated_on: string | null;
    cycle_days: number;
    evaluation_hour: number;
    status: string;
  } | null;
  onRegister: (date: string, cycleDays: number, evaluationHour: number) => Promise<void>;
  onUpdate: (date: string, cycleDays: number, evaluationHour: number) => Promise<void>;
  onRunEvaluation: () => Promise<EvaluationResultSummary>;
}

// 日付フォーマット用のユーティリティ
const formatDateJP = (dateStr: string | undefined | null) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
};

// 30日後を計算するユーティリティ（UTCベースで計算してズレを防ぐ）
const addDays = (dateStr: string | null | undefined, days: number) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return ''; // 無効な日付の場合は空文字列を返す
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]!;
};

export function EvaluationSettings({
  currentEvaluation,
  onRegister,
  onUpdate,
  onRunEvaluation,
}: EvaluationSettingsProps) {
  const { isOwnerViewMode } = useLiffContext();
  const [isOpen, setIsOpen] = useState(false);
  // date string format: YYYY-MM-DD
  const [dateStr, setDateStr] = useState<string>('');
  const [cycleDays, setCycleDays] = useState<number>(30);
  const [evaluationHour, setEvaluationHour] = useState<number>(12);
  const [loading, setLoading] = useState(false);
  const [runningEvaluation, setRunningEvaluation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReadOnly = isOwnerViewMode;

  const isUpdateMode = !!currentEvaluation;

  // ダイアログが開いたときに初期値をセット
  useEffect(() => {
    if (isOpen) {
      if (currentEvaluation && currentEvaluation.base_evaluation_date) {
        // 型推論の曖昧さを排除するためにテンプレートリテラルで文字列化
        setDateStr(`${currentEvaluation.base_evaluation_date}`);
        setCycleDays(currentEvaluation.cycle_days);
        setEvaluationHour(currentEvaluation.evaluation_hour ?? 12);
      } else {
        // 今日をデフォルトに
        const today = new Date().toISOString().split('T')[0]!;
        setDateStr(today);
        setCycleDays(30);
        setEvaluationHour(12);
      }
      setError(null);
    }
  }, [isOpen, currentEvaluation]);

  const handleSubmit = async () => {
    if (isReadOnly) return;
    if (!dateStr) return;

    setLoading(true);
    setError(null);

    const promise = isUpdateMode
      ? onUpdate(dateStr, cycleDays, evaluationHour)
      : onRegister(dateStr, cycleDays, evaluationHour);

    toast.promise(promise, {
      loading: '設定を保存中...',
      success: () => {
        setIsOpen(false);
        return isUpdateMode ? '評価基準日を更新しました' : '評価を開始しました';
      },
      error: err => {
        return err instanceof Error ? err.message : 'エラーが発生しました';
      },
    });

    try {
      await promise;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleRunEvaluation = async () => {
    if (isReadOnly) return;
    setRunningEvaluation(true);
    try {
      const result = await onRunEvaluation();

      // インポート失敗があった場合は警告を表示
      if (result.skippedImportFailed > 0) {
        toast.warning(
          `${result.skippedImportFailed}件でデータ取得に失敗しました（GSC再認証が必要な可能性があります）`
        );
      }

      if (result.processed > 0) {
        toast.success(
          `評価完了: ${result.processed}件処理（改善: ${result.improved}件、その他: ${result.advanced}件）`
        );
      } else if (result.baselineInitialized > 0) {
        toast.success(`${result.baselineInitialized}件の評価ベースラインを設定しました`);
        return;
      } else if (result.skippedNoMetrics > 0) {
        toast.info('評価対象のデータがありませんでした');
      } else if (result.skippedImportFailed === 0) {
        toast.info('評価対象の記事がありませんでした');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '評価処理に失敗しました');
    } finally {
      setRunningEvaluation(false);
    }
  };

  const nextEvaluationDateStr = dateStr ? addDays(dateStr, cycleDays) : '';
  const firstEvaluationDateStr = nextEvaluationDateStr ? addDays(nextEvaluationDateStr, cycleDays) : '';
  const hasCompletedInitialMeasurement = !!currentEvaluation?.last_evaluated_on;
  const initialMeasurementDate = currentEvaluation
    ? addDays(currentEvaluation.base_evaluation_date, currentEvaluation.cycle_days || 30)
    : '';
  const initialEvaluationDate = initialMeasurementDate
    ? addDays(initialMeasurementDate, currentEvaluation?.cycle_days || 30)
    : '';
  const nextScheduledEvaluationDate =
    hasCompletedInitialMeasurement && currentEvaluation
      ? addDays(
          currentEvaluation.last_evaluated_on || currentEvaluation.base_evaluation_date,
          currentEvaluation.cycle_days || 30
        )
      : '';

  return (
    <div className="space-y-4 border-t pt-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            評価サイクル設定
            {currentEvaluation?.status === 'active' && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                稼働中
              </span>
            )}
            {currentEvaluation?.status === 'paused' && (
              <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700 ring-1 ring-inset ring-yellow-600/20">
                一時停止中
              </span>
            )}
            {currentEvaluation?.status === 'completed' && (
              <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-600/20">
                完了
              </span>
            )}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {currentEvaluation
              ? `${currentEvaluation.cycle_days}日ごとに検索順位の変動を自動的に追跡・評価します`
              : '設定した日数ごとに検索順位の変動を自動的に追跡・評価します'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="default" disabled={isReadOnly}>
                <Settings className="w-4 h-4" />
                {isUpdateMode ? '設定を変更' : '評価を開始'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {isUpdateMode ? '評価基準日の変更' : '評価サイクルの開始'}
                </DialogTitle>
                <DialogDescription>
                  基準日を設定すると、その日から設定した日数後に初回の順位評価が行われます。
                </DialogDescription>
              </DialogHeader>

              <div className="px-6 pt-3 pb-6 space-y-6">
                <div className="inline-flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
                  <Info className="h-4 w-4 mt-[1px] flex-shrink-0" />
                  <span>
                    評価日は「当日の計測値」ではなく、最新に取得できたSearch
                    Consoleデータ（日付付き）を対象に判定します。
                    データが遅延する場合でも最終取得日の数値で評価されます。
                  </span>
                </div>
                <div className="inline-flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 ring-1 ring-blue-200">
                  <Info className="h-4 w-4 mt-[1px] flex-shrink-0" />
                  <span>
                    対象ページが未インデックス、または検索実績（表示回数）がない場合は「データ未取得」になることがあります。
                    Search
                    Consoleの反映には通常2〜3日の遅延があるため、しばらく待ってから再確認してください。
                  </span>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="evaluation-date"
                    className="text-sm font-medium text-gray-700 block"
                  >
                    評価基準日
                  </label>
                  <div className="relative">
                    <Input
                      id="evaluation-date"
                      type="date"
                      value={dateStr}
                      onChange={e => setDateStr(e.target.value)}
                      className="pl-10 text-base" // スマホでの操作性を考慮してtext-baseにするのも一案
                      disabled={isReadOnly}
                    />
                    <CalendarIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400 pointer-events-none" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    カレンダーアイコンをタップするか、直接入力してください
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="cycle-days" className="text-sm font-medium text-gray-700 block">
                      評価サイクル日数
                    </label>
                    <Input
                      id="cycle-days"
                      type="number"
                      min={1}
                      max={365}
                      value={cycleDays}
                      onChange={e =>
                        setCycleDays(Math.max(1, Math.min(365, Number(e.target.value))))
                      }
                      className="w-full text-base"
                      disabled={isReadOnly}
                    />
                    <p className="text-xs text-muted-foreground">
                      1〜365日の範囲で指定できます（デフォルト: 30日）
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="evaluation-hour"
                      className="text-sm font-medium text-gray-700 block"
                    >
                      評価実行時間
                    </label>
                    <div className="relative">
                      <Select
                        value={evaluationHour.toString()}
                        onValueChange={v => setEvaluationHour(Number(v))}
                        disabled={isReadOnly}
                      >
                        <SelectTrigger className="w-full pl-10 text-base">
                          <SelectValue placeholder="時間を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {HOUR_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Clock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400 pointer-events-none" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      評価バッチが実行される時間（日本時間）
                    </p>
                  </div>
                </div>

                {dateStr && (
                  <div className="rounded-lg bg-blue-50 p-4 border border-blue-100 space-y-3">
                    <div className="flex items-start gap-2">
                      <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-blue-900">評価スケジュールのプレビュー</p>
                        <div className="mt-3 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                          <div>
                            <p className="text-blue-600 text-xs mb-1">基準日</p>
                            <p className="font-semibold text-blue-900">{formatDateJP(dateStr)}</p>
                          </div>
                          <div>
                            <p className="text-blue-600 text-xs mb-1">初回計測日</p>
                            <p className="font-semibold text-blue-900">
                              {formatDateJP(nextEvaluationDateStr)}{' '}
                              {evaluationHour.toString().padStart(2, '0')}:00 (日本時間)
                            </p>
                          </div>
                          <div>
                            <p className="text-blue-600 text-xs mb-1">初回評価日</p>
                            <p className="font-semibold text-blue-900">
                              {formatDateJP(firstEvaluationDateStr)}{' '}
                              {evaluationHour.toString().padStart(2, '0')}:00 (日本時間)
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-blue-700">
                          評価日は月単位ではなく、設定した日数単位で計算されます。
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>エラー</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setIsOpen(false)}
                  disabled={loading || isReadOnly}
                >
                  キャンセル
                </Button>
                <Button onClick={handleSubmit} disabled={loading || !dateStr || isReadOnly}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {isUpdateMode ? '更新して保存' : 'この日程で開始'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 今すぐ評価を実行ボタン（評価設定がある場合のみ表示） */}
          {currentEvaluation && (
            <Button
              variant="outline"
              onClick={handleRunEvaluation}
              disabled={runningEvaluation || isReadOnly}
              className="gap-2"
            >
              {runningEvaluation ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              今すぐ評価を実行
            </Button>
          )}
        </div>
      </div>

      {/* 現在の状態表示カード */}
      {currentEvaluation ? (
        <div
          className={`grid grid-cols-1 gap-4 mt-4 ${
            hasCompletedInitialMeasurement ? 'md:grid-cols-2' : 'md:grid-cols-3'
          }`}
        >
          <div className="rounded-lg border border-blue-200 bg-blue-50 shadow-sm p-4">
            <div className="text-sm text-blue-600 mb-1">現在の評価基準日</div>
            <div className="text-2xl font-bold text-blue-900">
              {formatDateJP(currentEvaluation.base_evaluation_date)}
            </div>
          </div>
          {hasCompletedInitialMeasurement ? (
            <div className="rounded-lg border border-green-200 bg-green-50 shadow-sm p-4">
              <div className="text-sm text-green-600 mb-1">次回評価予定</div>
              <div className="text-2xl font-bold text-green-900">
                {formatDateJP(nextScheduledEvaluationDate)}{' '}
                {(currentEvaluation.evaluation_hour ?? 12).toString().padStart(2, '0')}:00
                (日本時間)
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 shadow-sm p-4">
                <div className="text-sm text-cyan-600 mb-1">初回計測予定</div>
                <div className="text-2xl font-bold text-cyan-900">
                  {formatDateJP(initialMeasurementDate)}{' '}
                  {(currentEvaluation.evaluation_hour ?? 12).toString().padStart(2, '0')}:00
                  (日本時間)
                </div>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 shadow-sm p-4">
                <div className="text-sm text-green-600 mb-1">初回評価予定</div>
                <div className="text-2xl font-bold text-green-900">
                  {formatDateJP(initialEvaluationDate)}{' '}
                  {(currentEvaluation.evaluation_hour ?? 12).toString().padStart(2, '0')}:00
                  (日本時間)
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed p-8 text-center bg-gray-50/50 mt-4">
          <p className="text-muted-foreground font-medium mb-1">未設定</p>
          <p className="text-sm text-gray-500">
            まだ評価サイクルが設定されていません。「評価を開始」ボタンから設定してください。
          </p>
        </div>
      )}
    </div>
  );
}
