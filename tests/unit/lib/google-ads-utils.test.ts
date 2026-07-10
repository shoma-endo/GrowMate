import { describe, expect, it } from 'vitest';

import { calculateCampaignSummary } from '@/lib/google-ads-utils';
import type { GoogleAdsCampaignMetrics } from '@/types/googleAds.types';

function createCampaign(
  overrides: Partial<GoogleAdsCampaignMetrics> = {}
): GoogleAdsCampaignMetrics {
  return {
    campaignId: '1',
    campaignName: 'キャンペーン',
    status: 'ENABLED',
    clicks: 0,
    impressions: 0,
    cost: 0,
    ctr: 0,
    cpc: 0,
    qualityScore: null,
    conversions: 0,
    costPerConversion: null,
    searchImpressionShare: null,
    conversionRate: null,
    ...overrides,
  };
}

describe('calculateCampaignSummary', () => {
  it('空配列では合計と平均をゼロ、share平均をnullにする', () => {
    expect(calculateCampaignSummary([])).toEqual({
      totalClicks: 0,
      totalImpressions: 0,
      totalCost: 0,
      totalConversions: 0,
      avgCtr: 0,
      avgCpc: 0,
      avgConversionRate: 0,
      avgCostPerConversion: 0,
      avgSearchImpressionShare: null,
    });
  });

  it('合計値と平均値を算出する', () => {
    const campaigns = [
      createCampaign({ clicks: 10, impressions: 100, cost: 5000, conversions: 2 }),
      createCampaign({ clicks: 0, impressions: 0, cost: 1000, conversions: 0 }),
    ];

    expect(calculateCampaignSummary(campaigns)).toMatchObject({
      totalClicks: 10,
      totalImpressions: 100,
      totalCost: 6000,
      totalConversions: 2,
      avgCtr: 0.1,
      avgCpc: 600,
      avgConversionRate: 0.2,
      avgCostPerConversion: 3000,
    });
  });

  it('ENABLEDかつshareがnullでないキャンペーンだけで平均する', () => {
    const campaigns = [
      createCampaign({ campaignId: '1', searchImpressionShare: 0.4 }),
      createCampaign({ campaignId: '2', searchImpressionShare: 0.8 }),
      createCampaign({ campaignId: '3', searchImpressionShare: null }),
      createCampaign({ campaignId: '4', status: 'PAUSED', searchImpressionShare: 1 }),
    ];

    expect(calculateCampaignSummary(campaigns).avgSearchImpressionShare).toBeCloseTo(0.6);
  });
});
