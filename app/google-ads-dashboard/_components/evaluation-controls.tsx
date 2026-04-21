'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, Mail, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getEvaluationSettings,
  runGoogleAdsAiAnalysis,
  updateEvaluationSettings,
} from '@/server/actions/googleAdsEvaluation.actions';
import type { GoogleAdsEvaluationSettings } from '@/types/google-ads-evaluation';

interface EvaluationControlsProps {
  hasEmailAddress: boolean;
  initialSettings: GoogleAdsEvaluationSettings;
}

function clampDateRangeDays(value: number): number {
  return Math.min(365, Math.max(1, Math.trunc(value)));
}

export function EvaluationControls({
  hasEmailAddress,
  initialSettings,
}: EvaluationControlsProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [dateRangeInput, setDateRangeInput] = useState(String(initialSettings.dateRangeDays));
  const [dateRangeError, setDateRangeError] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'default' | 'destructive'>('default');
  const [isRunning, startRunTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  useEffect(() => {
    setSettings(initialSettings);
    setDateRangeInput(String(initialSettings.dateRangeDays));
    setDateRangeError(false);
  }, [initialSettings]);

  const saveSettings = (nextSettings: GoogleAdsEvaluationSettings) => {
    const prevSettings = settings;
    setSettings(nextSettings);
    startSaveTransition(async () => {
      const result = await updateEvaluationSettings({
        dateRangeDays: nextSettings.dateRangeDays,
        cronEnabled: nextSettings.cronEnabled,
      });

      if (!result.success) {
        setStatusTone('destructive');
        setStatusMessage(result.error ?? '設定の保存に失敗しました');
        setSettings(prevSettings);
        setDateRangeInput(String(prevSettings.dateRangeDays));
        return;
      }

      setStatusTone('default');
      setStatusMessage('AI分析設定を保存しました');
    });
  };

  const refreshSettings = () => {
    startSaveTransition(async () => {
      const result = await getEvaluationSettings();
      if (!result.success || !result.data) {
        setStatusTone('destructive');
        setStatusMessage(result.error ?? '設定の再取得に失敗しました');
        return;
      }

      setSettings(result.data);
      setStatusTone('default');
      setStatusMessage(null);
    });
  };

  const handleRun = () => {
    startRunTransition(async () => {
      const result = await runGoogleAdsAiAnalysis();
      if (!result.success) {
        setStatusTone('destructive');
        setStatusMessage(result.error ?? 'AI分析の実行に失敗しました');
        return;
      }

      setStatusTone('default');
      setStatusMessage(result.message ?? 'AI分析を開始しました');
      refreshSettings();
    });
  };

  return (
    <div className="rounded-xl border bg-slate-50 p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">AI分析メール送信</h2>
          <p className="text-sm text-slate-600">
            Google Adsのキーワード指標をAIで分析し、登録メールアドレスにレポートを送信します。
          </p>
        </div>
        <Button onClick={handleRun} disabled={!hasEmailAddress || isRunning || isSaving}>
          {isRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          AI分析を実行してメール送信
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="date-range-days">分析期間（日数）</Label>
          <Input
            id="date-range-days"
            type="number"
            min={1}
            max={365}
            value={dateRangeInput}
            aria-invalid={dateRangeError}
            disabled={isSaving}
            onChange={event => {
              const nextRawValue = event.target.value;
              const nextValue = Number(nextRawValue);
              const fallbackValue = 1;
              const normalizedValue = Number.isFinite(nextValue)
                ? clampDateRangeDays(nextValue)
                : fallbackValue;
              const hasValidationError =
                !Number.isInteger(nextValue) || normalizedValue !== nextValue;

              setDateRangeInput(String(normalizedValue));
              setDateRangeError(hasValidationError);
              saveSettings({ ...settings, dateRangeDays: normalizedValue });
            }}
            onBlur={() => {
              if (!dateRangeError) {
                return;
              }

              setDateRangeInput(String(settings.dateRangeDays));
              setDateRangeError(false);
            }}
          />
          {dateRangeError && (
            <p className="text-xs text-red-600">1〜365 の整数を入力してください。</p>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-md border bg-white px-3 py-2">
          <Checkbox
            id="cron-enabled"
            checked={settings.cronEnabled}
            disabled={isSaving}
            onCheckedChange={checked => {
              saveSettings({ ...settings, cronEnabled: checked === true });
            }}
          />
          <div className="space-y-1">
            <Label htmlFor="cron-enabled" className="cursor-pointer">
              定期自動送信を有効化
            </Label>
            <p className="text-xs text-slate-500">
              連続エラーが3回に達すると cron 対象から自動的に外れます。
            </p>
          </div>
        </div>

        <Button variant="outline" onClick={refreshSettings} disabled={isSaving || isRunning}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          設定を再読込
        </Button>
      </div>

      {settings.lastEvaluatedOn && (
        <p className="text-xs text-slate-500">最終成功実行日: {settings.lastEvaluatedOn}</p>
      )}

      {!hasEmailAddress && (
        <Alert variant="destructive">
          <AlertTitle>メールアドレス未登録</AlertTitle>
          <AlertDescription>
            メールアドレスが未登録のため、Google Ads AI分析メールは送信できません。
          </AlertDescription>
        </Alert>
      )}

      {statusMessage && (
        <Alert variant={statusTone === 'destructive' ? 'destructive' : 'default'}>
          <AlertTitle>{statusTone === 'destructive' ? 'エラー' : 'ステータス'}</AlertTitle>
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
