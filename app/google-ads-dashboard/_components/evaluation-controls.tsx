'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServiceSelector } from '@/components/ServiceSelector';
import { LinkedMessage } from '@/components/LinkedMessage';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GOOGLE_ADS_REAUTH_LINK_RULES } from '@/lib/constants';
import { getBrief } from '@/server/actions/brief.actions';
import {
  getEvaluationSettings,
  runGoogleAdsAiAnalysis,
  updateEvaluationSettings,
} from '@/server/actions/googleAdsEvaluation.actions';
import type { Service } from '@/server/schemas/brief.schema';
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
  const [statusTone, setStatusTone] = useState<'success' | 'destructive'>('success');
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [isServicesLoading, setIsServicesLoading] = useState(true);
  const [isRunning, startRunTransition] = useTransition();
  const [isSavingDateRange, startSaveDateRangeTransition] = useTransition();

  useEffect(() => {
    setSettings(initialSettings);
    setDateRangeInput(String(initialSettings.dateRangeDays));
    setDateRangeError(false);
  }, [initialSettings]);

  useEffect(() => {
    let isActive = true;
    setIsServicesLoading(true);

    const loadServices = async () => {
      const result = await getBrief();
      if (!isActive) {
        return;
      }

      if (!result.success) {
        setServicesError(result.error ?? '事業者情報の取得に失敗しました。');
        setServices([]);
        setSelectedServiceId(null);
        setIsServicesLoading(false);
        return;
      }

      const nextServices = result.data?.services ?? [];
      setServices(nextServices);
      setServicesError(null);
      setSelectedServiceId(prev =>
        prev && nextServices.some(service => service.id === prev)
          ? prev
          : nextServices[0]?.id ?? null
      );
      setIsServicesLoading(false);
    };

    loadServices();

    return () => {
      isActive = false;
    };
  }, []);

  const isServiceMissing = !isServicesLoading && !servicesError && services.length === 0;
  const cannotRunForServices = isServicesLoading || Boolean(servicesError) || isServiceMissing;

  const handleRun = () => {
    if (isServiceMissing) {
      setStatusTone('destructive');
      setStatusMessage(ERROR_MESSAGES.GOOGLE_ADS.AI_EVALUATION_SERVICE_REQUIRED);
      return;
    }

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

      const result = await runGoogleAdsAiAnalysis({
        ...(selectedServiceId ? { serviceId: selectedServiceId } : {}),
      });
      if (!result.success) {
        setStatusTone('destructive');
        setStatusMessage(result.error ?? 'AI分析の実行に失敗しました');
        return;
      }

      setStatusTone('success');
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
          <h2 className="text-lg font-semibold text-slate-900">
            Google Ads コンテンツ戦略提案
          </h2>
          <p className="text-sm text-slate-600">
            キーワード指標をもとに、コンテンツ戦略の改善提案をメールで送信します。
          </p>
        </div>
        <Button
          onClick={handleRun}
          disabled={!hasEmailAddress || isRunning || cannotRunForServices}
        >
          {isRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          コンテンツ戦略提案を送信
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {services.length > 1 && (
          <div className="space-y-2">
            <Label>分析対象サービス</Label>
            <ServiceSelector
              services={services}
              selectedServiceId={selectedServiceId}
              onServiceChange={setSelectedServiceId}
              disabled={isRunning}
            />
          </div>
        )}

        <div className="max-w-[180px] space-y-2">
          <Label htmlFor="date-range-days">AI分析期間（日数）</Label>
          <Input
            id="date-range-days"
            type="number"
            min={1}
            max={365}
            value={dateRangeInput}
            aria-invalid={dateRangeError}
            disabled={isRunning || isSavingDateRange}
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

              const previousDays = settings.dateRangeDays;
              if (nextDateRangeDays === previousDays) {
                return;
              }

              startSaveDateRangeTransition(async () => {
                const saveResult = await updateEvaluationSettings({
                  dateRangeDays: nextDateRangeDays,
                });
                if (!saveResult.success) {
                  setStatusTone('destructive');
                  setStatusMessage(saveResult.error ?? '設定の保存に失敗しました');
                  setDateRangeInput(String(previousDays));
                  return;
                }

                setSettings(prev => ({ ...prev, dateRangeDays: nextDateRangeDays }));
              });
            }}
          />
          {dateRangeError && (
            <p className="text-xs text-red-600">1〜365 の整数を入力してください。</p>
          )}
        </div>
      </div>

      {isServiceMissing && (
        <Alert variant="destructive">
          <AlertTitle>サービス未登録</AlertTitle>
          <AlertDescription>
            Google Ads コンテンツ戦略提案を実行するには、事業者情報でサービスを登録してください。
            <Button variant="link" asChild className="h-auto px-1 py-0">
              <Link href="/business-info">事業者情報を設定</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {settings.lastEvaluatedOn && (
        <p className="text-xs text-slate-500">最終成功実行日: {settings.lastEvaluatedOn}</p>
      )}

      {!hasEmailAddress && (
        <Alert variant="destructive">
          <AlertTitle>メールアドレス未登録</AlertTitle>
          <AlertDescription>
            メールアドレスが未登録のため、Google Ads コンテンツ戦略提案レポートは送信できません。
          </AlertDescription>
        </Alert>
      )}

      {servicesError && (
        <Alert variant="destructive">
          <AlertTitle>事業者情報の取得エラー</AlertTitle>
          <AlertDescription>{servicesError}</AlertDescription>
        </Alert>
      )}

      {statusMessage && (
        <Alert variant={statusTone}>
          <AlertTitle>{statusTone === 'destructive' ? 'エラー' : '送信完了'}</AlertTitle>
          <AlertDescription>
            <LinkedMessage message={statusMessage} rules={GOOGLE_ADS_REAUTH_LINK_RULES} />
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
