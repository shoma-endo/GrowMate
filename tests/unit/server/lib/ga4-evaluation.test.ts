/**
 * コンテンツ評価の純関数
 *
 * スコア算出・診断コード判定（`ga4-content-scoring`）、メディア全体スコアと順位
 * （`ga4-content-score-aggregation`）、LLM へ渡す Context の組み立て
 * （`ga4-evaluation-context`）、プロンプトの変数展開（`ga4-content-evaluation-prompt`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 集計 / 評価 / 表示」であってモジュール名ではないため、
 * その単位でまとめている。どのモジュールの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import {
  ENGAGE_ANCHORS,
  READ_ANCHORS,
  calculateAverageEngagementSeconds,
  calculateContentScore,
  calculateExpectedReadSeconds,
  evaluateGa4ContentScore,
  interpolateScore,
  resolveDiagnosis,
} from '@/server/lib/ga4-content-scoring';
import { calculateMediaScores, rankByContentScore } from '@/server/lib/ga4-content-score-aggregation';
import { buildGa4EvaluationContext } from '@/server/lib/ga4-evaluation-context';
import {
  buildGa4EvaluationPromptVariables,
  renderGa4EvaluationUserPrompt,
} from '@/server/lib/ga4-content-evaluation-prompt';
import type { Ga4EvaluationContext } from '@/types/ga4-evaluation';

describe('@/server/lib/ga4-content-scoring', () => {
  describe('ga4-content-scoring', () => {
    it('アンカー補間と上下限を固定する', () => {
      for (const [ratio, score] of READ_ANCHORS) expect(interpolateScore(ratio, READ_ANCHORS)).toBe(score);
      for (const [ratio, score] of ENGAGE_ANCHORS) expect(interpolateScore(ratio, ENGAGE_ANCHORS)).toBe(score);
      expect(interpolateScore(-1, READ_ANCHORS)).toBe(0);
      expect(interpolateScore(1, READ_ANCHORS)).toBe(100);
      expect(interpolateScore(0.09, READ_ANCHORS)).toBe(30);
      expect(interpolateScore(0.1, READ_ANCHORS)).toBe(33);
    });

    it('期待読了時間と幾何平均を算出する', () => {
      expect(calculateExpectedReadSeconds(500, 2)).toBe(66);
      expect(calculateExpectedReadSeconds(500, null)).toBe(60);
      expect(calculateContentScore(100, 20)).toBe(45);
      expect(calculateContentScore(60, 60)).toBe(60);
      expect(calculateContentScore(0, 100)).toBe(0);
    });

    it('activeUsersを分母にし、欠損を維持する', () => {
      expect(calculateAverageEngagementSeconds(120, 4)).toBe(30);
      expect(calculateAverageEngagementSeconds(120, null)).toBeNull();
      expect(calculateAverageEngagementSeconds(120, 0)).toBeNull();
    });

    it('診断マトリクス全セルの境界と完読率併用を固定する', () => {
      expect(resolveDiagnosis(39, 59, null).code).toBe('R_TOP_EXIT');
      expect(resolveDiagnosis(40, 59, null).code).toBe('R_TOP_EXIT');
      expect(resolveDiagnosis(40, 60, null).code).toBe('R_SKIM');
      expect(resolveDiagnosis(60, 59, null).code).toBe('R_MISMATCH');
      expect(resolveDiagnosis(60, 60, null).code).toBe('R_GOOD');
      expect(resolveDiagnosis(80, 0, null).code).toBe('R_MISMATCH');
      expect(resolveDiagnosis(80, 60, null).code).toBe('R_GOOD');
      expect(resolveDiagnosis(60, 0, null).code).toBe('R_MISMATCH');
      expect(resolveDiagnosis(60, 60, null).code).toBe('R_GOOD');
      expect(resolveDiagnosis(40, 0, null).code).toBe('R_TOP_EXIT');
      expect(resolveDiagnosis(40, 60, null).code).toBe('R_SKIM');
      expect(resolveDiagnosis(0, 0, null).code).toBe('R_TOP_EXIT');
      expect(resolveDiagnosis(0, 60, null).code).toBe('R_MID_EXIT');
      expect(resolveDiagnosis(39, 60, 0.14).code).toBe('R_TOP_EXIT');
      expect(resolveDiagnosis(39, 60, 0.15).code).toBe('R_MID_EXIT');
      expect(resolveDiagnosis(39, 60, 0.4)).toEqual({ code: 'R_MID_EXIT', auxiliaryLabel: '流し読み型' });
    });

    it('完読率が未計測(null)なら併用そのものを行わず、マトリクス判定を上書きしない', () => {
      // 未計測を 0 と混同すると 0 < 0.15 が成立し、読了40未満の記事が
      // 計測していない完読率を根拠に R_TOP_EXIT へ強制上書きされる（BR-02 / §6.2.4）
      expect(resolveDiagnosis(39, 60, null)).toEqual({ code: 'R_MID_EXIT', auxiliaryLabel: null });
      expect(resolveDiagnosis(39, 60, 0).code).toBe('R_TOP_EXIT');
    });

    it('30セッション未満は低データとし、同一入力は決定的に評価する', () => {
      expect(evaluateGa4ContentScore({ sessions: 29, readRate: 0.5, engagementRate: 0.5, scrollRate: 0.5 }).diagnosis.code).toBe('R_LOWDATA');
      const input = { sessions: 30, readRate: 0.12, engagementRate: 0.4, scrollRate: null } as const;
      expect(evaluateGa4ContentScore(input)).toEqual(evaluateGa4ContentScore(input));
    });
  });
});

describe('@/server/lib/ga4-content-score-aggregation', () => {
  describe('ga4-content-score-aggregation', () => {
    it('同点同順位を返す', () => {
      expect(rankByContentScore([
        { id: 'a', contentScore: 80, sessions: 10, readScore: 80, engageScore: 80 },
        { id: 'b', contentScore: 80, sessions: 10, readScore: 80, engageScore: 80 },
        { id: 'c', contentScore: 50, sessions: 10, readScore: 50, engageScore: 50 },
      ])).toEqual([
        { id: 'a', contentScore: 80, sessions: 10, readScore: 80, engageScore: 80, rank: 1 },
        { id: 'b', contentScore: 80, sessions: 10, readScore: 80, engageScore: 80, rank: 1 },
        { id: 'c', contentScore: 50, sessions: 10, readScore: 50, engageScore: 50, rank: 2 },
      ]);
      expect(rankByContentScore([])).toEqual([]);
    });

    it('メディア全体スコアを算出する', () => {
      expect(calculateMediaScores([
        { contentScore: 80, sessions: 10 },
        { contentScore: 40, sessions: 30 },
      ])).toEqual({ assetValueScore: 60, effectiveScore: 50, evaluatedCount: 2, totalCount: 2 });
      expect(calculateMediaScores([])).toEqual({ assetValueScore: null, effectiveScore: null, evaluatedCount: 0, totalCount: 0 });
    });

  });
});

describe('@/server/lib/ga4-evaluation-context', () => {
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
});

describe('@/server/lib/ga4-content-evaluation-prompt', () => {
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

      const prompt = renderGa4EvaluationUserPrompt(
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

      const prompt = renderGa4EvaluationUserPrompt(
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

      const prompt = renderGa4EvaluationUserPrompt(
        '最後までスクロールした人数: {{scroll_users}}人（全体の{{scroll_rate}}%）',
        variables,
        { scrollRate: 0.2, scrollUsers: 20 }
      );
      expect(prompt).toContain('最後までスクロールした人数: 20人（全体の20%）');
    });
  });
});
