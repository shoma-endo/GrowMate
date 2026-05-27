'use client';

import { useEffect, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Mail,
  MailCheck,
  PauseCircle,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  getNegativeKeywordsSuggestionSettings,
  runNegativeKeywordsSuggestionNow,
  updateNegativeKeywordsSuggestionSettings,
} from '@/server/actions/googleAdsNegativeKeywordsSuggestion.actions';
import { Badge } from '@/components/ui/badge';
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
  label: `${String(hour).padStart(2, '0')}:00 JST`,
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await updateNegativeKeywordsSuggestionSettings({
        enabled: nextSettings.enabled,
        sendHourJst: nextSettings.sendHourJst,
      });
      if (result.success) {
        setMessage('設定を保存しました');
        return;
      }
      setError(result.error ?? '設定の保存に失敗しました');
    });
  };

  const handleRunNow = () => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const result = await runNegativeKeywordsSuggestionNow();
      if (result.success) {
        setMessage(result.message ?? 'テスト送信を開始しました');
        return;
      }
      setError(result.error ?? 'テスト送信に失敗しました');
    });
  };

  const disabled = isLoading || isPending || !hasGoogleAdsReady;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border bg-slate-50 p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-900">
              Google Ads 除外キーワード提案メール
            </h2>
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
              メール設定
            </Badge>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            設定した時刻に、前日の検索クエリから除外候補をカテゴリ、提案レベル、緊急度で整理し、
            登録メールアドレス宛に送信します。
          </p>
        </div>

        <div className="mt-6 rounded-lg border bg-white p-4">
          {!hasGoogleAdsReady && (
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Google Ads 連携と広告アカウント選択が完了すると設定できます。</span>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0 bg-white">
                <Link href="/setup/google-ads">連携設定へ</Link>
              </Button>
            </div>
          )}

          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900">設定項目</h3>
            <p className="mt-1 text-xs text-slate-500">
              自動配信の有効化と配信時刻を設定します。検索語句データは連携済み広告アカウント一式から取得します。
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label>自動配信</Label>
              <Button
                type="button"
                variant={settings.enabled ? 'default' : 'outline'}
                role="switch"
                aria-checked={settings.enabled}
                className="w-full justify-start gap-2 lg:min-w-[168px]"
                disabled={disabled}
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
                disabled={disabled}
                onValueChange={value =>
                  saveSettings({ ...settings, sendHourJst: Number(value) })
                }
              >
                <SelectTrigger id="negative-keywords-send-hour" className="w-full md:w-[180px]">
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
        </div>

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">送信状況</h3>
            <p className="text-xs text-slate-500">
              最終送信日と直近エラーを確認できます。
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-3">
          <StatusItem
            icon={<Clock3 className="h-4 w-4" />}
            label="設定中の配信時刻"
            value={`${String(settings.sendHourJst).padStart(2, '0')}:00 JST`}
          />
          <StatusItem
            icon={<MailCheck className="h-4 w-4" />}
            label="最終送信日"
            value={settings.lastSentOn ?? '未送信'}
          />
          <StatusItem
            icon={<ShieldAlert className="h-4 w-4" />}
            label="最終エラー"
            value={settings.lastSendError ?? 'なし'}
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            自動配信が OFF の場合でも、登録メールアドレス宛に 1 通だけ手動送信できます。
          </div>
          <Button
            type="button"
            className="gap-2"
            disabled={disabled || !hasEmailAddress}
            onClick={handleRunNow}
          >
            <Send className="h-4 w-4" />
            今すぐテスト送信
          </Button>
        </div>

        {!hasEmailAddress && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" />
            メール送信にはアカウントのメールアドレス登録が必要です。
          </div>
        )}

        {message && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </section>

      <aside className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
            <div className="space-y-2 text-sm text-slate-600">
              <h3 className="font-semibold text-slate-900">停止／再開について</h3>
              <p>
                自動配信を OFF にすると、次回以降の配信を停止します。配信時刻の変更は、
                次回の配信から反映されます。
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function StatusItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-slate-500">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate text-sm font-medium text-slate-900">{value}</div>
      </div>
    </div>
  );
}
