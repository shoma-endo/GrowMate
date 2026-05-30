import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MetricsCards } from './metrics-cards';
import { CampaignsTable } from './campaigns-table';
import { GoogleAdsDashboardTabs } from './GoogleAdsDashboardTabs';
import { GoogleAdsMailSettingsPanel } from './GoogleAdsMailSettingsPanel';
import { LinkedMessage } from '@/components/LinkedMessage';
import { calculateCampaignSummary } from '@/lib/google-ads-utils';
import { GOOGLE_ADS_REAUTH_LINK_RULES } from '@/lib/constants';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import type { GoogleAdsEvaluationSettings } from '@/types/google-ads-evaluation';
import type {
  GoogleAdsCampaignMetrics,
  GoogleAdsKeywordMetric,
  GoogleAdsErrorKind,
} from '@/types/googleAds.types';

interface DashboardContentProps {
  campaigns: GoogleAdsCampaignMetrics[];
  keywords: GoogleAdsKeywordMetric[];
  hasEmailAddress: boolean;
  hasGoogleAdsReady: boolean;
  initialSettings: GoogleAdsEvaluationSettings;
  errorMessage?: string;
  errorKind?: GoogleAdsErrorKind;
}

export function DashboardContent({
  campaigns,
  keywords,
  hasEmailAddress,
  hasGoogleAdsReady,
  initialSettings,
  errorMessage,
  errorKind = 'unknown',
}: DashboardContentProps) {
  const summary = calculateCampaignSummary(campaigns);
  const hasData = campaigns.length > 0;
  const hasError = Boolean(errorMessage);

  const errorGuidance: Record<NonNullable<DashboardContentProps['errorKind']>, string> = {
    not_connected: ERROR_MESSAGES.GOOGLE_ADS.DASHBOARD_GUIDANCE_NOT_CONNECTED,
    not_selected: ERROR_MESSAGES.GOOGLE_ADS.DASHBOARD_GUIDANCE_NOT_SELECTED,
    auth_expired: ERROR_MESSAGES.GOOGLE_ADS.DASHBOARD_GUIDANCE_AUTH_EXPIRED,
    account_disabled: ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_DISABLED,
    unknown: ERROR_MESSAGES.GOOGLE_ADS.DASHBOARD_GUIDANCE_UNKNOWN,
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            Google Ads パフォーマンス
          </h1>
          <p className="text-gray-500">連携済みアカウントの広告パフォーマンス概要</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled>
            期間: 過去30日間
          </Button>
        </div>
      </div>

      <GoogleAdsDashboardTabs
        metricsContent={
          <>
            {hasError && (
              <Alert variant="destructive">
                <AlertTitle>データ取得に失敗しました</AlertTitle>
                <AlertDescription className="space-y-2">
                  <div>
                    <LinkedMessage message={errorMessage ?? ''} rules={GOOGLE_ADS_REAUTH_LINK_RULES} />
                  </div>
                  <p className="text-sm">{errorGuidance[errorKind]}</p>
                  <div className="pt-2">
                    <Button asChild variant="outline">
                      <Link href="/setup/google-ads">
                        {errorKind === 'not_selected'
                          ? 'アカウント選択へ'
                          : errorKind === 'account_disabled'
                            ? '連携設定へ'
                            : 'Google Ads 連携設定へ'}
                      </Link>
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* データがない場合 */}
            {!hasData && !hasError && (
              <div className="text-center py-12 text-gray-500">
                <p>表示できるデータがありません</p>
              </div>
            )}

            {/* Metrics Cards */}
            {hasData && <MetricsCards summary={summary} />}

            {/* Campaigns Table */}
            {hasData && <CampaignsTable campaigns={campaigns} />}

            {/* Keywords Data (debug or info) */}
            {keywords.length > 0 && (
              <div className="pt-8">
                <h2 className="text-xl font-semibold mb-4 text-gray-700">上位キーワードパフォーマンス</h2>
                <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">
                  上位 {keywords.length} 件のキーワードを表示中。集計値はキャンペーン全件の合計です。
                </div>
                {/* Note: Keywords could be shown in a table as well if desired */}
              </div>
            )}
          </>
        }
        settingsContent={
          <GoogleAdsMailSettingsPanel
            hasEmailAddress={hasEmailAddress}
            hasGoogleAdsReady={hasGoogleAdsReady}
            initialSettings={initialSettings}
          />
        }
      />
    </div>
  );
}
