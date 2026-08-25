'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Info, Calendar as CalendarIcon, Settings, Save, Clock } from 'lucide-react';
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
import { addDaysISO } from '@/lib/date-utils';
import {
  fetchGa4ContentEvaluationCycle,
  registerGa4ContentEvaluationCycle,
  updateGa4ContentEvaluationCycle,
} from '@/server/actions/ga4ContentEvaluationCycle.actions';
import type { Ga4ContentEvaluationCycleView } from '@/types/ga4-evaluation-cycle';

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i.toString(),
  label: `${i.toString().padStart(2, '0')}:00`,
}));

interface ContentEvaluationCycleSettingsProps {
  annotationId: string;
  /** GA4連携の再認証が必要か（GscDashboardClient の ga4Evaluation.needsReauth をそのまま渡す。§10.8） */
  needsReauth?: boolean;
}

const formatDateJP = (dateStr: string | undefined | null) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d);
};

export function ContentEvaluationCycleSettings({
  annotationId,
  needsReauth = false,
}: ContentEvaluationCycleSettingsProps) {
  const [cycle, setCycle] = useState<Ga4ContentEvaluationCycleView | null>(null);
  const [cycleLoading, setCycleLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [dateStr, setDateStr] = useState<string>('');
  const [cycleDays, setCycleDays] = useState<number>(30);
  const [evaluationHour, setEvaluationHour] = useState<number>(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUpdateMode = !!cycle;

  useEffect(() => {
    let cancelled = false;
    setCycleLoading(true);
    fetchGa4ContentEvaluationCycle(annotationId).then(result => {
      if (cancelled) return;
      if (result.success) setCycle(result.data ?? null);
      setCycleLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [annotationId]);

  useEffect(() => {
    if (isOpen) {
      if (cycle) {
        setDateStr(cycle.baseEvaluationDate);
        setCycleDays(cycle.cycleDays);
        setEvaluationHour(cycle.evaluationHour);
      } else {
        setDateStr(new Date().toISOString().split('T')[0]!);
        setCycleDays(30);
        setEvaluationHour(12);
      }
      setError(null);
    }
  }, [isOpen, cycle]);

  const handleSubmit = async () => {
    if (!dateStr) return;
    setLoading(true);
    setError(null);

    const action = isUpdateMode ? updateGa4ContentEvaluationCycle : registerGa4ContentEvaluationCycle;
    const promise = action({
      annotationId,
      baseEvaluationDate: dateStr,
      cycleDays,
      evaluationHour,
    });

    toast.promise(promise, {
      loading: '設定を保存中...',
      success: result => {
        if (!result.success || !result.data) throw new Error(result.error);
        setCycle(result.data);
        setIsOpen(false);
        return isUpdateMode ? 'コンテンツ評価サイクルを更新しました' : 'コンテンツ評価を開始しました';
      },
      error: err => (err instanceof Error ? err.message : 'エラーが発生しました'),
    });

    try {
      const result = await promise;
      if (!result.success) setError(result.error ?? 'エラーが発生しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const previewInitialMeasurementDate = dateStr;
  const previewInitialEvaluationDate = dateStr ? addDaysISO(dateStr, cycleDays) : '';
  // last_seen_content_score は GSC の last_seen_position 相当（§7.7）。バッチは毎回の評価成功時に
  // これを更新するため、登録時のベースライン取得が失敗しても以後の定期評価が成功すれば解消する。
  const hasBaseline = cycle?.lastSeenContentScore != null;
  // GSC (EvaluationSettings.tsx:406-447) と同型の状態カード分岐（D10確定・§10.8「差はなし」）。
  // 初回計測前は nextEvaluationDate が「次に取得を試みる日」を表すため、それを「初回計測予定」に、
  // その1サイクル先を「初回評価予定」に充てる。
  const initialMeasurementDate = cycle?.nextEvaluationDate ?? '';
  const initialEvaluationDate = initialMeasurementDate
    ? addDaysISO(initialMeasurementDate, cycle?.cycleDays ?? 30)
    : '';

  if (cycleLoading) {
    return (
      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          コンテンツ評価サイクル設定を読み込み中...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t pt-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            コンテンツ評価サイクル設定
            {cycle?.status === 'active' && (
              <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                稼働中
              </span>
            )}
            {cycle?.status === 'paused' && (
              <span className="inline-flex items-center rounded-full bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700 ring-1 ring-inset ring-yellow-600/20">
                一時停止中
              </span>
            )}
            {cycle?.status === 'completed' && (
              <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-600/20">
                完了
              </span>
            )}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {cycle
              ? `${cycle.cycleDays}日ごとにエンゲージメント率・読了率を自動的に評価します`
              : '設定した日数ごとにエンゲージメント率・読了率を自動的に評価します'}
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="default">
              <Settings className="w-4 h-4" />
              {isUpdateMode ? '設定を変更' : 'コンテンツ評価を開始'}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[670px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {isUpdateMode ? 'コンテンツ評価サイクルの変更' : 'コンテンツ評価サイクルの開始'}
              </DialogTitle>
              <DialogDescription />
            </DialogHeader>

            <div className="px-6 pt-3 pb-6 space-y-6">
              <div className="inline-flex items-start gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 ring-1 ring-blue-200">
                <Info className="h-4 w-4 mt-[1px] flex-shrink-0" />
                <span>
                  評価対象期間は直近90日で固定です。評価サイクルは、次に評価するまでの間隔です。
                  {!isUpdateMode && '開始すると同時に、初回のベースライン評価を実行します。'}
                </span>
              </div>

              <div className="space-y-2">
                <label htmlFor="ga4-cycle-evaluation-date" className="text-sm font-medium text-gray-700 block">
                  基準日
                </label>
                <div className="relative">
                  <Input
                    id="ga4-cycle-evaluation-date"
                    type="date"
                    value={dateStr}
                    onChange={e => setDateStr(e.target.value)}
                    className="pl-10 text-base"
                  />
                  <CalendarIcon className="absolute left-3 top-2.5 h-5 w-5 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="ga4-cycle-days" className="text-sm font-medium text-gray-700 block">
                    評価サイクル日数
                  </label>
                  <Input
                    id="ga4-cycle-days"
                    type="number"
                    min={1}
                    max={365}
                    value={cycleDays}
                    onChange={e => setCycleDays(Math.max(1, Math.min(365, Number(e.target.value))))}
                    className="w-full text-base"
                  />
                  <p className="text-xs text-muted-foreground">1〜365日の範囲で指定できます（デフォルト: 30日）</p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="ga4-cycle-hour" className="text-sm font-medium text-gray-700 block">
                    評価実行時間
                  </label>
                  <div className="relative">
                    <Select value={evaluationHour.toString()} onValueChange={v => setEvaluationHour(Number(v))}>
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
                  <p className="text-xs text-muted-foreground">評価バッチが実行される時間（日本時間）</p>
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
                          <p className="font-semibold text-blue-900">{formatDateJP(previewInitialMeasurementDate)}</p>
                        </div>
                        <div>
                          <p className="text-blue-600 text-xs mb-1">初回評価日</p>
                          <p className="font-semibold text-blue-900">
                            {formatDateJP(previewInitialEvaluationDate)}{' '}
                            {evaluationHour.toString().padStart(2, '0')}:00 (日本時間)
                          </p>
                        </div>
                      </div>
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
              <Button variant="ghost" onClick={() => setIsOpen(false)} disabled={loading}>
                キャンセル
              </Button>
              <Button onClick={handleSubmit} disabled={loading || !dateStr}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isUpdateMode ? '更新して保存' : 'この日程で開始'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {cycle ? (
        <div className="space-y-2">
          {needsReauth && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-3 py-2 ring-1 ring-red-200">
              <p className="text-xs text-red-700">
                Google連携を確認してください。サイクルはそのまま残り、再連携すれば次回から自動的に動きます。
              </p>
              <Button asChild type="button" size="sm">
                <Link href="/setup/ga4">Googleを再連携</Link>
              </Button>
            </div>
          )}
          <div className={`grid grid-cols-1 gap-4 mt-4 ${hasBaseline ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
            <div className="rounded-lg border border-blue-200 bg-blue-50 shadow-sm p-4">
              <div className="text-sm text-blue-600 mb-1">現在の基準日</div>
              <div className="text-2xl font-bold text-blue-900">{formatDateJP(cycle.baseEvaluationDate)}</div>
            </div>
            {hasBaseline ? (
              <div className="rounded-lg border border-green-200 bg-green-50 shadow-sm p-4">
                <div className="text-sm text-green-600 mb-1">次回評価予定</div>
                <div className="text-2xl font-bold text-green-900">
                  {formatDateJP(cycle.nextEvaluationDate)} {cycle.evaluationHour.toString().padStart(2, '0')}:00
                  (日本時間)
                </div>
              </div>
            ) : (
              <>
                {/* 「初回計測日」はダイアログのプレビュー（登録操作＝即日にベースラインを取得する約束）
                    で使う語のため、ここでは使わない。ここは登録後にベースライン取得が失敗した
                    再試行待ちの状態（レアケース）なので「ベースライン再試行予定」と明示する（再レビュー指摘）。 */}
                <div className="rounded-lg border border-cyan-200 bg-cyan-50 shadow-sm p-4">
                  <div className="text-sm text-cyan-600 mb-1">ベースライン再試行予定</div>
                  <div className="text-2xl font-bold text-cyan-900">
                    {formatDateJP(initialMeasurementDate)} {cycle.evaluationHour.toString().padStart(2, '0')}:00
                    (日本時間)
                  </div>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 shadow-sm p-4">
                  <div className="text-sm text-green-600 mb-1">次回評価予定</div>
                  <div className="text-2xl font-bold text-green-900">
                    {formatDateJP(initialEvaluationDate)} {cycle.evaluationHour.toString().padStart(2, '0')}:00
                    (日本時間)
                  </div>
                </div>
              </>
            )}
          </div>
          {!hasBaseline && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2 ring-1 ring-amber-200">
              初回のベースライン評価がまだ完了していません。次回の定期評価（上記のベースライン再試行予定）で再試行されます。すぐに反映したい場合は、記事詳細の「コンテンツ評価」タブから今すぐ評価を実行してください。
            </p>
          )}
          {cycle.lastNotificationStatus === 'failed' && (
            <p className="text-xs text-red-700 bg-red-50 rounded-md px-3 py-2 ring-1 ring-red-200">
              前回の通知メールを送信できませんでした。
            </p>
          )}
          {cycle.lastNotificationStatus === 'skipped_no_email' && (
            <p className="text-xs text-gray-600 bg-gray-50 rounded-md px-3 py-2 ring-1 ring-gray-200">
              メールアドレスが未登録のため通知は送られません。評価結果はこの画面で確認できます。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            設定を変更すると次回以降の評価予定が変わります。評価の停止・削除は現在お使いいただけません。
          </p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed p-8 text-center bg-gray-50/50 mt-4">
          <p className="text-muted-foreground font-medium mb-1">未設定</p>
          <p className="text-sm text-gray-500">
            まだコンテンツ評価サイクルが設定されていません。「コンテンツ評価を開始」ボタンから設定してください。
          </p>
        </div>
      )}
    </div>
  );
}
