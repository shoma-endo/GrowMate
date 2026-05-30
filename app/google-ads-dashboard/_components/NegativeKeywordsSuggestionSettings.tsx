'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ShieldMinus,
  Loader2,
  Mail,
  PauseCircle,
} from 'lucide-react';
import {
  getNegativeKeywordsSuggestionSettings,
  runNegativeKeywordsSuggestionNow,
  updateNegativeKeywordsSuggestionSettings,
} from '@/server/actions/googleAdsNegativeKeywordsSuggestion.actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GoogleAdsNegativeKeywordsSuggestionSettings as Settings } from '@/types/google-ads-negative-keywords-suggestion';

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  sendHourJst: 7,
  lastSentOn: null,
  lastSendError: null,
};

const SEND_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

interface NegativeKeywordsSuggestionSettingsProps {
  hasEmailAddress: boolean;
  hasGoogleAdsReady: boolean;
}

export function NegativeKeywordsSuggestionSettings({
  hasEmailAddress,
  hasGoogleAdsReady,
}: NegativeKeywordsSuggestionSettingsProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<{
    title: string;
    description?: string;
    variant?: 'default' | 'success';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsPending, startSettingsTransition] = useTransition();
  const [isRunNowPending, startRunNowTransition] = useTransition();

  useEffect(() => {
    let mounted = true;

    getNegativeKeywordsSuggestionSettings()
      .then(result => {
        if (!mounted) {
          return;
        }
        if (result.success && result.data) {
          setSettings(result.data);
          setError(null);
          return;
        }
        setError(result.error ?? '設定の取得に失敗しました');
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const saveSettings = (nextSettings: Settings) => {
    setSettings(nextSettings);
    setNotice(null);
    setError(null);

    startSettingsTransition(async () => {
      const result = await updateNegativeKeywordsSuggestionSettings({
        enabled: nextSettings.enabled,
        sendHourJst: nextSettings.sendHourJst,
      });
      if (result.success) {
        setNotice({ title: '設定を保存しました' });
        return;
      }
      setError(result.error ?? '設定の保存に失敗しました');
    });
  };

  const handleRunNow = () => {
    setNotice(null);
    setError(null);

    startRunNowTransition(async () => {
      const result = await runNegativeKeywordsSuggestionNow();
      if (result.success) {
        setNotice({
          title: result.skipped ? '送信対象なし' : '送信完了',
          description:
            result.message ??
            (result.skipped ? '送信対象がありませんでした' : 'メールを送信しました'),
          variant: result.skipped ? 'default' : 'success',
        });
        return;
      }
      setError(result.error ?? '手動送信に失敗しました');
    });
  };

  const isBusy = isLoading || isSettingsPending || isRunNowPending;
  const settingsDisabled = isBusy || !hasGoogleAdsReady;
  const runNowDisabled = isBusy || !hasGoogleAdsReady || !hasEmailAddress;

  return (
    <div className="rounded-xl border bg-slate-50 p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <ShieldMinus className="h-5 w-5 text-emerald-600" />
              Google Ads 除外キーワード提案
            </h2>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            毎日指定時刻に、前日の検索クエリから除外候補をカテゴリ、提案レベル、緊急度で整理し、登録メールアドレス宛に自動配信します。
          </p>
        </div>
        <Button type="button" disabled={runNowDisabled} onClick={handleRunNow}>
          {isRunNowPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          除外キーワード提案を手動送信
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-2">
          <Label>自動配信</Label>
          <Button
            type="button"
            variant={settings.enabled ? 'default' : 'outline'}
            role="switch"
            aria-checked={settings.enabled}
            className="w-full justify-start gap-2 sm:w-[180px]"
            disabled={settingsDisabled}
            onClick={() => saveSettings({ ...settings, enabled: !settings.enabled })}
          >
            {settings.enabled ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <PauseCircle className="h-4 w-4" />
            )}
            {settings.enabled ? '自動配信 ON' : '自動配信 OFF'}
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="negative-keywords-send-hour">配信時刻</Label>
          <Select
            value={String(settings.sendHourJst)}
            disabled={settingsDisabled}
            onValueChange={value =>
              saveSettings({ ...settings, sendHourJst: Number(value) })
            }
          >
            <SelectTrigger id="negative-keywords-send-hour" className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEND_HOUR_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        最終送信日: {settings.lastSentOn ?? '未送信'} / 最終エラー:{' '}
        {settings.lastSendError ?? 'なし'} / 自動配信を OFF にすると、次回以降の自動配信を停止します。
        自動配信 OFF でも、このボタンからいつでも手動送信できます。
      </p>

      {!hasGoogleAdsReady && (
        <Alert variant="destructive">
          <AlertTitle>Google Ads 未連携</AlertTitle>
          <AlertDescription>
            Google Ads 連携と広告アカウント選択が完了すると設定できます。
            <Button variant="link" asChild className="h-auto px-1 py-0">
              <Link href="/setup/google-ads">連携設定へ</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!hasEmailAddress && (
        <Alert variant="destructive">
          <AlertTitle>メールアドレス未登録</AlertTitle>
          <AlertDescription>
            メールアドレスが未登録のため、Google Ads 除外キーワード提案レポートは送信できません。
          </AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.variant ?? 'success'}>
          <AlertTitle>{notice.title}</AlertTitle>
          {notice.description && (
            <AlertDescription>{notice.description}</AlertDescription>
          )}
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>エラー</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
