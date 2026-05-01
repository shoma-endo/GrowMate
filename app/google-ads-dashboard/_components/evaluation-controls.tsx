'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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

function parseDateRangeDays(value: string): number | null {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 365) {
    return null;
  }

  return numericValue;
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

  useEffect(() => {
    setSettings(initialSettings);
    setDateRangeInput(String(initialSettings.dateRangeDays));
    setDateRangeError(false);
  }, [initialSettings]);

  const handleRun = () => {
    const nextDateRangeDays = parseDateRangeDays(dateRangeInput);
    if (nextDateRangeDays === null) {
      setDateRangeError(true);
      setStatusTone('destructive');
      setStatusMessage('1〜365 の整数を入力してください。');
      return;
    }

    setDateRangeInput(String(nextDateRangeDays));
    setDateRangeError(false);
    startRunTransition(async () => {
      if (nextDateRangeDays !== settings.dateRangeDays) {
        const saveResult = await updateEvaluationSettings({
          dateRangeDays: nextDateRangeDays,
        });
        if (!saveResult.success) {
          setStatusTone('destructive');
          setStatusMessage(saveResult.error ?? '設定の保存に失敗しました');
          return;
        }

        setSettings({ ...settings, dateRangeDays: nextDateRangeDays });
      }

      const result = await runGoogleAdsAiAnalysis();
      if (!result.success) {
        setStatusTone('destructive');
        setStatusMessage(result.error ?? 'AI分析の実行に失敗しました');
        return;
      }

      setStatusTone('default');
      setStatusMessage(result.message ?? 'AI分析を開始しました');

      const settingsResult = await getEvaluationSettings();
      if (settingsResult.success && settingsResult.data) {
        setSettings(settingsResult.data);
        setDateRangeInput(String(settingsResult.data.dateRangeDays));
        setDateRangeError(false);
      } else {
        console.warn(
          '[EvaluationControls] Failed to refresh settings after analysis:',
          settingsResult.error
        );
      }
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
        <Button onClick={handleRun} disabled={!hasEmailAddress || isRunning}>
          {isRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          AI分析を実行してメール送信
        </Button>
      </div>

      <div className="max-w-[180px] space-y-2">
        <Label htmlFor="date-range-days">分析期間（日数）</Label>
        <Input
          id="date-range-days"
          type="number"
          min={1}
          max={365}
          value={dateRangeInput}
          aria-invalid={dateRangeError}
          disabled={isRunning}
          onChange={event => {
            setDateRangeInput(event.target.value);
            setDateRangeError(false);
          }}
          onBlur={() => {
            const nextDateRangeDays = parseDateRangeDays(dateRangeInput);
            if (nextDateRangeDays === null) {
              setDateRangeInput(String(settings.dateRangeDays));
              setDateRangeError(false);
              return;
            }

            setDateRangeInput(String(nextDateRangeDays));
            setDateRangeError(false);
          }}
        />
        {dateRangeError && (
          <p className="text-xs text-red-600">1〜365 の整数を入力してください。</p>
        )}
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
