import { describe, expect, it } from 'vitest';

import {
  buildGa4EvaluationPromptVariables,
  renderGa4EvaluationPrompt,
} from '@/server/lib/ga4-content-evaluation-prompt';
import type { Ga4EvaluationContext } from '@/types/ga4-evaluation';

const context = {
  article: {
    id: 'annotation-id',
    url: 'https://example.com/articles/one',
    title: '記事タイトル',
    charCount: 1000,
    imageCount: 2,
    headings: ['見出し'],
    publishedAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
  },
  period: { startDate: '2026-08-01', endDate: '2026-08-08' },
  fetchedAt: { ga4: '2026-08-09T00:00:00Z', gsc: null },
  freshness: { periodEndWithin48HoursOfGa4Fetch: true },
  ga4: { summary: null, daily: [] },
  gsc: { summary: null },
  dataQuality: { missingMetrics: [], partial: false, reasons: [] },
} satisfies Ga4EvaluationContext;

const scores = {
  contentScore: 70,
  engageScore: 80,
  readScore: 60,
  diagnosisCode: 'R_GOOD',
  rank: 1,
  totalArticles: 3,
  previousContentScore: 60,
  previousEngageScore: 70,
  previousReadScore: 50,
};

describe('ga4-content-evaluation-prompt', () => {
  it('正本の26変数をすべて組み立てる', () => {
    const variables = buildGa4EvaluationPromptVariables(context, scores, {
      sessions: 100,
      engagedUsers: 40,
      engagementRate: 0.4,
      avgEngagementSeconds: 45,
      expectedReadSeconds: 60,
      readRate: 0.75,
      scrollUsers: 20,
      scrollRate: 0.2,
    });

    expect(Object.keys(variables)).toHaveLength(26);
    expect(Object.values(variables).every(value => !value.includes('{{'))).toBe(true);
    expect(variables.engaged_users).toBe('40');
    expect(variables.avg_time_display).toBe('45秒');
    expect(variables.content_score_diff).toBe('+10');

    const missingScrollVariables = buildGa4EvaluationPromptVariables(context, scores, {
      sessions: 100,
      engagedUsers: 40,
      engagementRate: 0.4,
      avgEngagementSeconds: 45,
      expectedReadSeconds: 60,
      readRate: 0.75,
      scrollUsers: null,
      scrollRate: null,
    });
    expect(missingScrollVariables.scroll_users).toBe('未取得');
  });

  it('スクロール実測なしで率もない場合は人数も率も表示しない', () => {
    const variables = buildGa4EvaluationPromptVariables(context, scores, {
      sessions: 100,
      engagedUsers: 40,
      engagementRate: 0.4,
      avgEngagementSeconds: 45,
      expectedReadSeconds: 60,
      readRate: 0.75,
      scrollUsers: null,
      scrollRate: null,
    });

    const prompt = renderGa4EvaluationPrompt(
      '最後までスクロールした人数: {{scroll_users}}人（全体の{{scroll_rate}}%）',
      variables,
      { scrollRate: null, scrollUsers: null }
    );
    expect(prompt).toContain('最後までスクロールした人数: 実測なし');
    expect(prompt).not.toContain('12%');
    expect(prompt).not.toContain('実測なし人');
  });

  it('スクロール人数が実測できない場合はscroll率だけを表示する', () => {
    const variables = buildGa4EvaluationPromptVariables(context, scores, {
      sessions: 100,
      engagedUsers: 40,
      engagementRate: 0.4,
      avgEngagementSeconds: 45,
      expectedReadSeconds: 60,
      readRate: 0.75,
      scrollUsers: null,
      scrollRate: 0.2,
    });

    const prompt = renderGa4EvaluationPrompt(
      '最後までスクロールした人数: {{scroll_users}}人（全体の{{scroll_rate}}%）',
      variables,
      { scrollRate: 0.2, scrollUsers: null }
    );
    expect(prompt).toContain('実測なし。1人あたり平均で全体の20%まで読まれています');
  });

  it('スクロール実測がある場合は人数と率を維持する', () => {
    const variables = buildGa4EvaluationPromptVariables(context, scores, {
      sessions: 100,
      engagedUsers: 40,
      engagementRate: 0.4,
      avgEngagementSeconds: 45,
      expectedReadSeconds: 60,
      readRate: 0.75,
      scrollUsers: 20,
      scrollRate: 0.2,
    });

    const prompt = renderGa4EvaluationPrompt(
      '最後までスクロールした人数: {{scroll_users}}人（全体の{{scroll_rate}}%）',
      variables,
      { scrollRate: 0.2, scrollUsers: 20 }
    );
    expect(prompt).toContain('最後までスクロールした人数: 20人（全体の20%）');
  });
});
