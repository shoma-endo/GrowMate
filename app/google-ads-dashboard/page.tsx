import { DashboardContent } from './_components/dashboard-content';
import { fetchKeywordMetrics, fetchCampaignMetrics } from '@/server/actions/googleAds.actions';
import { getEvaluationSettings } from '@/server/actions/googleAdsEvaluation.actions';
import { authMiddleware } from '@/server/middleware/auth.middleware';
import type { GoogleAdsErrorKind } from '@/types/googleAds.types';
import { buildLocalDateRange } from '@/lib/date-utils';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

// 動的レンダリングを強制（Server Action で cookies を使用するため）
export const dynamic = 'force-dynamic';

/**
 * エラーメッセージからエラー種別を判定する
 */
function resolveErrorKind(errorMessage: string): GoogleAdsErrorKind {
  switch (errorMessage) {
    case ERROR_MESSAGES.GOOGLE_ADS.NOT_CONNECTED:
      return 'not_connected';
    case ERROR_MESSAGES.GOOGLE_ADS.ACCOUNT_NOT_SELECTED:
      return 'not_selected';
    case ERROR_MESSAGES.GOOGLE_ADS.AUTH_EXPIRED_OR_REVOKED:
      return 'auth_expired';
    case ERROR_MESSAGES.USER.ADMIN_REQUIRED:
      return 'admin_required';
    default:
      return 'unknown';
  }
}

export default async function GoogleAdsDashboardPage() {
  const authResult = await authMiddleware();
  const hasEmailAddress = Boolean(authResult.userDetails?.email);
  const evaluationSettingsResult = await getEvaluationSettings();
  const evaluationSettings =
    evaluationSettingsResult.success && evaluationSettingsResult.data
      ? evaluationSettingsResult.data
      : {
          dateRangeDays: 30,
          cronEnabled: false,
          lastEvaluatedOn: null,
        };

  // 過去30日間の日付範囲を計算（JST基準、今日含む30日間）
  const { startDate, endDate } = buildLocalDateRange(30);

  // キャンペーン指標とキーワード指標を並行して取得
  const [campaignResult, keywordResult] = await Promise.all([
    fetchCampaignMetrics(startDate, endDate),
    fetchKeywordMetrics(startDate, endDate),
  ]);

  // いずれかで重大なエラー（認証系など）が発生した場合はエラー表示
  if (!campaignResult.success) {
    const errorMessage = campaignResult.error ?? ERROR_MESSAGES.GOOGLE_ADS.DASHBOARD_FETCH_FAILED;
    return (
      <DashboardContent
        campaigns={[]}
        keywords={[]}
        hasEmailAddress={hasEmailAddress}
        initialSettings={evaluationSettings}
        errorMessage={errorMessage}
        errorKind={resolveErrorKind(errorMessage)}
      />
    );
  }

  const campaigns = campaignResult.data ?? [];
  const keywords = keywordResult.success ? (keywordResult.data ?? []) : [];

  return (
    <DashboardContent
      campaigns={campaigns}
      keywords={keywords}
      hasEmailAddress={hasEmailAddress}
      initialSettings={evaluationSettings}
    />
  );
}
