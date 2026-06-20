'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertCircle, Lightbulb, Loader2, Mail } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServiceSelector } from '@/components/ServiceSelector';
import { LinkedMessage, type LinkedMessageRule } from '@/components/LinkedMessage';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { GOOGLE_ADS_REAUTH_LINK_RULES } from '@/lib/constants';
import { getBrief } from '@/server/actions/brief.actions';
import {
  getContentInventoryStatus,
  getEvaluationSettings,
  getGscDataFreshness,
  runGoogleAdsAiAnalysis,
  updateEvaluationSettings,
} from '@/server/actions/googleAdsEvaluation.actions';
import type { Service } from '@/server/schemas/brief.schema';
import type {
  GoogleAdsEvaluationSettings,
  GscDataFreshness,
} from '@/types/google-ads-evaluation';

interface EvaluationControlsProps {
  hasEmailAddress: boolean;
  initialSettings: GoogleAdsEvaluationSettings;
}

/** GSC 検索順位データを「古い」と判定して注意喚起するしきい値（日数）。GSC は通常 2〜3 日の遅延がある。 */
const GSC_STALE_THRESHOLD_DAYS = 14;

const GSC_NOTICE_RULES: LinkedMessageRule[] = [
  { phrase: 'Search Console データをインポート', href: '/gsc-import', variant: 'button-link' },
];

const WP_NOTICE_RULES: LinkedMessageRule[] = [
  { phrase: 'WordPress 記事をインポート', href: '/wordpress-import', variant: 'button-link' },
];

function areInitialSettingsEqual(
  a: Pick<GoogleAdsEvaluationSettings, 'dateRangeDays' | 'lastEvaluatedOn'>,
  b: Pick<GoogleAdsEvaluationSettings, 'dateRangeDays' | 'lastEvaluatedOn'>
): boolean {
  return a.dateRangeDays === b.dateRangeDays && a.lastEvaluatedOn === b.lastEvaluatedOn;
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
  const [gscFreshness, setGscFreshness] = useState<GscDataFreshness | null>(null);
  const [hasContentInventory, setHasContentInventory] = useState<boolean | null>(null);
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
  const prevInitialSettingsRef = useRef({
    dateRangeDays: initialSettings.dateRangeDays,
    lastEvaluatedOn: initialSettings.lastEvaluatedOn,
  });

  if (!areInitialSettingsEqual(prevInitialSettingsRef.current, initialSettings)) {
    prevInitialSettingsRef.current = {
      dateRangeDays: initialSettings.dateRangeDays,
      lastEvaluatedOn: initialSettings.lastEvaluatedOn,
    };
    setSettings(initialSettings);
    setDateRangeInput(String(initialSettings.dateRangeDays));
    setDateRangeError(false);
  }

  useEffect(() => {
    let isActive = true;

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

  // 提案データの準備状況（GSC 鮮度・WP 在庫）を取得。古い/無い時だけ注意喚起する（失敗時は何も出さない）。
  useEffect(() => {
    let isActive = true;
    Promise.all([getGscDataFreshness(), getContentInventoryStatus()]).then(
      ([freshness, inventory]) => {
        if (!isActive) {
          return;
        }
        if (freshness.success && freshness.data) {
          setGscFreshness(freshness.data);
        }
        if (inventory.success && typeof inventory.hasContent === 'boolean') {
          setHasContentInventory(inventory.hasContent);
        }
      }
    );
    return () => {
      isActive = false;
    };
  }, []);

  const isServiceMissing = !isServicesLoading && !servicesError && services.length === 0;
  const cannotRunForServices = isServicesLoading || Boolean(servicesError) || isServiceMissing;

  // 検索順位データの鮮度に応じた注意喚起（古い/無い時だけ表示）。
  const gscNoData = gscFreshness ? !gscFreshness.hasData : false;
  const gscStale = Boolean(
    gscFreshness?.hasData &&
      gscFreshness.daysStale !== null &&
      gscFreshness.daysStale >= GSC_STALE_THRESHOLD_DAYS
  );
  const gscNoticeTitle = gscNoData
    ? '検索順位データがありません'
    : '検索順位データが古い可能性があります';
  const gscNoticeMessage = gscNoData
    ? 'Search Console の検索順位データがまだ取り込まれていません（未連携の場合は連携も必要です）。提案に含まれる「検索順位」は表示されません。Search Console データをインポートしてください。'
    : `最新の検索順位データは ${gscFreshness?.latestDate}（約${gscFreshness?.daysStale}日前）です。提案に表示される順位が現在の実態とずれている場合があります。最新化するには Search Console データをインポートしてください。`;
  // WordPress 記事在庫が無い時の注意喚起（新規/既存修正の判定材料が不足するため）。
  const wpNoInventory = hasContentInventory === false;
  const wpNoticeMessage =
    'WordPress 記事が未取込のため、提案の「新規作成 / 既存修正」の判定材料が不足します。WordPress 記事をインポートしてください。';

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
      setStatusMessage(result.message ?? 'メールを送信しました');

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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <Lightbulb className="h-5 w-5 text-sky-600" />
              Google Ads コンテンツ戦略提案
            </h2>
          </div>
          <p className="text-sm text-slate-600">
            必要なタイミングで、キーワード指標をもとにコンテンツ戦略の改善提案をメールで送信します。
          </p>
          <p className="text-xs text-slate-500">
            <span className="block">
              ※「既存修正」の対象記事は WordPress
              に取り込み済みの記事から選定されます。トップページ等の未取込ページは対象に表示されない場合があります。
            </span>
            <span className="block">
              <LinkedMessage
                message="未取込なら WordPress 記事をインポート してください。"
                rules={WP_NOTICE_RULES}
              />
            </span>
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
          <Label htmlFor="date-range-days">分析対象期間（日数）</Label>
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

      {(gscNoData || gscStale) && (
        <Alert className="bg-amber-50 border-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
            <AlertTitle className="mb-0 text-amber-900">{gscNoticeTitle}</AlertTitle>
          </div>
          <AlertDescription className="mt-1 text-amber-800">
            <LinkedMessage message={gscNoticeMessage} rules={GSC_NOTICE_RULES} />
          </AlertDescription>
        </Alert>
      )}

      {wpNoInventory && (
        <Alert className="bg-amber-50 border-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
            <AlertTitle className="mb-0 text-amber-900">既存コンテンツが取り込まれていません</AlertTitle>
          </div>
          <AlertDescription className="mt-1 text-amber-800">
            <LinkedMessage message={wpNoticeMessage} rules={WP_NOTICE_RULES} />
          </AlertDescription>
        </Alert>
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
