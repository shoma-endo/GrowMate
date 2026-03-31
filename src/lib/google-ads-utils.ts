import type {
  GoogleAdsCampaignMetrics,
  GoogleAdsCampaignSummary,
} from '@/types/googleAds.types';

/**
 * キャンペーンデータからサマリーを計算
 */
export function calculateCampaignSummary(
  campaigns: GoogleAdsCampaignMetrics[]
): GoogleAdsCampaignSummary {
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalCost = campaigns.reduce((sum, c) => sum + c.cost, 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + c.conversions, 0);

  // 検索インプレッションシェア（有効キャンペーンの平均）
  const enabledWithShare = campaigns.filter(
    c => c.status === 'ENABLED' && c.searchImpressionShare !== null
  );
  const avgSearchImpressionShare =
    enabledWithShare.length > 0
      ? enabledWithShare.reduce((sum, c) => sum + (c.searchImpressionShare ?? 0), 0) /
        enabledWithShare.length
      : null;

  return {
    totalClicks,
    totalImpressions,
    totalCost,
    totalConversions,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgCpc: totalClicks > 0 ? totalCost / totalClicks : 0,
    avgConversionRate: totalClicks > 0 ? totalConversions / totalClicks : 0,
    avgCostPerConversion: totalConversions > 0 ? totalCost / totalConversions : 0,
    avgSearchImpressionShare,
  };
}
