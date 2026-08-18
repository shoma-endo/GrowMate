import { describe, expect, it } from 'vitest';

import { buildGa4EvaluationContext } from '@/server/lib/ga4-evaluation-context';

const ga4Summary = {
  normalizedPath: '/articles/one',
  dateFrom: '2026-08-01',
  dateTo: '2026-08-08',
  sessions: 0,
  users: 0,
  engagementTimeSec: 0,
  bounceRate: null,
  engagementRate: null,
  activeUsers: null,
  cvEventCount: 0,
  scroll90EventCount: 0,
  scrollMetricsAvailable: true,
  searchClicks: 99,
  impressions: 100,
  ctr: 0.99,
  isSampled: false,
  isPartial: false,
};

describe('ga4-evaluation-context', () => {
  it('評価入力ではsessions 0の直帰率を欠損として保持し、GA4検索指標を注入しない', () => {
    const context = buildGa4EvaluationContext({
      annotation: {
        id: 'annotation-id',
        canonical_url: 'https://example.com/articles/one',
        wp_post_title: '記事タイトル',
      },
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      ga4Summary,
      ga4DailyMetrics: [
        {
          date: '2026-08-01',
          normalizedPath: '/articles/one',
          sessions: 0,
          users: 0,
          engagementTimeSec: 0,
          bounceRate: 0,
          engagementRate: null,
          activeUsers: null,
          cvEventCount: 0,
          scroll90EventCount: 0,
          searchClicks: 99,
          impressions: 100,
          isSampled: false,
          isPartial: false,
        },
      ],
      gscSummary: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
      ga4FetchedAt: '2026-08-08T00:00:00.000Z',
      gscFetchedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(context.ga4.summary?.bounceRate).toBeNull();
    expect(context.ga4.daily[0]?.bounceRate).toBeNull();
    expect(context.ga4.summary).not.toHaveProperty('searchClicks');
    expect(context.ga4.summary).not.toHaveProperty('impressions');
    expect(context.ga4.summary).not.toHaveProperty('ctr');
    expect(context.dataQuality.missingMetrics).toContain('bounce_rate');
    expect(context.dataQuality.missingMetrics).not.toContain('gsc');
    expect(context.freshness.periodEndWithin48HoursOfGa4Fetch).toBe(true);
  });

  it('本文全文をLLMへ渡さず、正規化後の文字数と見出しを保持する', () => {
    const context = buildGa4EvaluationContext({
      annotation: {
        id: 'annotation-id',
        canonical_url: 'https://example.com/articles/one',
        wp_post_title: '記事タイトル',
        wp_content_text: '本文  &amp;  テキスト',
        wp_excerpt: '要約',
        basic_structure: 'h2 見出し1\nh3 除外\nh2 見出し2',
        wp_image_count: null,
      },
      startDate: '2026-08-01',
      endDate: '2026-08-08',
      ga4Summary: null,
      ga4DailyMetrics: [],
      gscSummary: null,
      ga4FetchedAt: null,
      gscFetchedAt: null,
    });

    expect(context.article.charCount).toBe('本文 & テキスト'.length);
    expect(context.article.imageCount).toBeNull();
    expect(context.article.headings).toEqual(['見出し1', '見出し2']);
    expect(context.article.title).toBe('記事タイトル');
    expect(context.article.url).toBe('https://example.com/articles/one');
    expect(context.dataQuality.partial).toBe(true);
    expect(context.dataQuality.missingMetrics).not.toContain('gsc');
  });
});
