/**
 * GA4コンテンツ評価の定期評価まわりの純関数
 *
 * due 判定（`ga4-content-evaluation-due`）、定期評価バッチの結末判定契約
 * （`ga4-content-evaluation-batch-outcome`）、通知メールの文面組み立て
 * （`ga4-content-evaluation-email`）、メールHTMLの無害化（`email-html`）。
 * docs/plans/ga4-content-evaluation-spec.md §6.6.2 / §8.3 / §9.5 / §10.9 の正本。
 */
import { describe, expect, it } from 'vitest';
import { isGa4ContentEvaluationDue } from '@/server/lib/ga4-content-evaluation-due';
import {
  classifyGa4BatchRunError,
  classifyGa4BatchRunResult,
} from '@/server/lib/ga4-content-evaluation-batch-outcome';
import { buildGa4ContentEvaluationEmail } from '@/server/lib/ga4-content-evaluation-email';
import { sanitizeEmailHtml } from '@/server/lib/email-html';
import type { Ga4ContentEvaluationView, Ga4PersistentEvaluationStatus } from '@/types/ga4-evaluation';

describe('@/server/lib/ga4-content-evaluation-due', () => {
  describe('isGa4ContentEvaluationDue', () => {
    it('next_evaluation_date が過去なら常にdue', () => {
      expect(isGa4ContentEvaluationDue('2026-08-23', 12, '2026-08-24', 0)).toBe(true);
      expect(isGa4ContentEvaluationDue('2026-08-23', 23, '2026-08-24', 0)).toBe(true);
    });

    it('next_evaluation_date が未来ならdueではない', () => {
      expect(isGa4ContentEvaluationDue('2026-08-25', 0, '2026-08-24', 23)).toBe(false);
    });

    it('next_evaluation_date が当日ならevaluation_hourの前後で判定する（GSCのisDueと同値）', () => {
      const today = '2026-08-24';
      expect(isGa4ContentEvaluationDue(today, 12, today, 11)).toBe(false); // hour-1
      expect(isGa4ContentEvaluationDue(today, 12, today, 12)).toBe(true); // hour ちょうど
      expect(isGa4ContentEvaluationDue(today, 12, today, 13)).toBe(true); // hour+1
    });
  });
});

const CALL_STARTED_AT = 1_756_000_000_000;

function createView(overrides: Partial<Ga4ContentEvaluationView> = {}): Ga4ContentEvaluationView {
  return {
    settingsEnabled: true,
    displayStatus: 'evaluated',
    missingMetrics: [],
    projection: null,
    history: [],
    ...overrides,
  };
}

function createHistoryItem(
  overrides: Partial<Ga4ContentEvaluationView['history'][number]> = {}
): Ga4ContentEvaluationView['history'][number] {
  return {
    id: 'history-1',
    status: 'evaluated',
    startedAt: new Date(CALL_STARTED_AT + 1000).toISOString(),
    completedAt: new Date(CALL_STARTED_AT + 2000).toISOString(),
    attemptCount: 1,
    readRate: 0.3,
    engageRate: 0.5,
    scrollRate: null,
    readScore: 80,
    engageScore: 70,
    contentScore: 75,
    diagnosisCode: 'R_GOOD',
    siteRank: 3,
    totalArticles: 10,
    expectedReadSeconds: 120,
    avgEngagementSeconds: 90,
    sessions: 50,
    charCount: 1000,
    imageCount: 2,
    narrative: { headline: 'h', situation: 's', cause: 'c', next_action: 'n', target: 't' },
    dataQuality: null,
    periodStart: '2026-05-27',
    periodEnd: '2026-08-24',
    ga4DataFetchedAt: null,
    errorCode: null,
    ...overrides,
  };
}

describe('@/server/lib/ga4-content-evaluation-batch-outcome', () => {
  describe('classifyGa4BatchRunResult', () => {
    it.each<Ga4PersistentEvaluationStatus>([
      'evaluated',
      'narrative_failed',
      'insufficient_data',
      'import_failed',
      'evaluation_failed',
    ])('永続状態 %s は今回の履歴行の status をそのまま結末にし、クールダウンを進める', status => {
      const view = createView({ history: [createHistoryItem({ status })] });
      const result = classifyGa4BatchRunResult(view, CALL_STARTED_AT);
      expect(result).toEqual({
        outcome: status,
        historyId: 'history-1',
        shouldAdvanceCooldown: true,
        isUnexpected: false,
      });
    });

    it('evaluating が返った場合は異常系としてクールダウンを進めない', () => {
      const view = createView({ history: [createHistoryItem({ status: 'evaluating' })] });
      const result = classifyGa4BatchRunResult(view, CALL_STARTED_AT);
      expect(result).toEqual({
        outcome: 'evaluating',
        historyId: 'history-1',
        shouldAdvanceCooldown: false,
        isUnexpected: true,
      });
    });

    it('履歴が空ならBR-08の足切りとしてlow_dataとし、クールダウンを進める', () => {
      const view = createView({ history: [], displayStatus: 'low_data' });
      const result = classifyGa4BatchRunResult(view, CALL_STARTED_AT);
      expect(result).toEqual({
        outcome: 'low_data',
        historyId: null,
        shouldAdvanceCooldown: true,
        isUnexpected: false,
      });
    });

    it('前回の成功履歴（呼び出し開始時刻より前のstartedAt）を今回の結果と誤判定しない', () => {
      const staleHistory = createHistoryItem({
        id: 'previous-history',
        status: 'evaluated',
        startedAt: new Date(CALL_STARTED_AT - 60_000).toISOString(),
      });
      const view = createView({ history: [staleHistory], displayStatus: 'evaluated' });
      const result = classifyGa4BatchRunResult(view, CALL_STARTED_AT);
      // displayStatus='evaluated' に釣られてevaluatedと判定してはならない（回帰: 前回結果でメールを送る）
      expect(result.outcome).toBe('low_data');
      expect(result.historyId).toBeNull();
      expect(result.shouldAdvanceCooldown).toBe(true);
    });

    it.each<Ga4ContentEvaluationView['displayStatus']>(['unassessed', 'eligible'])(
      'displayStatus=%s かつ履歴なしは想定外としてクールダウンを進めない',
      displayStatus => {
        const view = createView({ history: [], displayStatus });
        const result = classifyGa4BatchRunResult(view, CALL_STARTED_AT);
        expect(result).toEqual({
          outcome: 'unknown_error',
          historyId: null,
          shouldAdvanceCooldown: false,
          isUnexpected: true,
        });
      }
    );
  });

  describe('classifyGa4BatchRunError', () => {
    it('"already running" を含む例外はalready_runningとしクールダウンを進めない', () => {
      const error = new Error('ga4 evaluation already running');
      expect(classifyGa4BatchRunError(error)).toEqual({
        outcome: 'already_running',
        historyId: null,
        shouldAdvanceCooldown: false,
        isUnexpected: false,
      });
    });

    it('その他の例外はunknown_errorとし、クールダウンは進める（外部要因のため毎時再試行しても解消しない）', () => {
      const error = new Error('unexpected db error');
      expect(classifyGa4BatchRunError(error)).toEqual({
        outcome: 'unknown_error',
        historyId: null,
        shouldAdvanceCooldown: true,
        isUnexpected: true,
      });
    });

    it('Error以外がthrowされてもunknown_errorとして扱う', () => {
      expect(classifyGa4BatchRunError('string thrown').outcome).toBe('unknown_error');
      expect(classifyGa4BatchRunError(null).outcome).toBe('unknown_error');
    });
  });
});

describe('@/server/lib/email-html', () => {
  describe('sanitizeEmailHtml', () => {
    it('script/style/コメント/on*属性/javascript:リンク/埋め込みタグを除去する', () => {
      const input = [
        '<div onclick="alert(1)">text</div>',
        '<script>evil()</script>',
        '<style>body{color:red}</style>',
        '<!-- comment -->',
        '<a href="javascript:alert(1)">link</a>',
        '<iframe src="x"></iframe>',
      ].join('');
      const output = sanitizeEmailHtml(input);
      expect(output).not.toContain('<script');
      expect(output).not.toContain('<style');
      expect(output).not.toContain('<!--');
      expect(output).not.toContain('onclick');
      expect(output).not.toContain('javascript:');
      expect(output).not.toContain('<iframe');
      expect(output).toContain('text');
      expect(output).toContain('link');
    });

    it('空文字は空文字を返す', () => {
      expect(sanitizeEmailHtml('')).toBe('');
    });
  });
});

describe('@/server/lib/ga4-content-evaluation-email', () => {
  describe('buildGa4ContentEvaluationEmail', () => {
    const baseInput = {
      articleTitle: 'サンプル記事タイトル',
      canonicalUrl: 'https://example.com/blog/sample-article',
      annotationId: 'annotation-1',
      siteUrl: 'https://app.growmate.tokyo',
      status: 'evaluated' as const,
      contentScore: 75,
      readScore: 80,
      engageScore: 70,
      siteRank: 3,
      totalArticles: 10,
      narrative: { headline: '見出し', situation: '状況説明', next_action: '次の一手', target: '狙い' },
      periodStart: '2026-05-27',
      periodEnd: '2026-08-24',
      nextEvaluationDate: '2026-09-23',
    };

    it('件名に記事タイトルを含め、本文に遷移先URL・スコア・診断・次の一手を含める', () => {
      const content = buildGa4ContentEvaluationEmail(baseInput);
      expect(content.subject).toBe('【GrowMate】コンテンツ評価が完了しました：サンプル記事タイトル');
      expect(content.html).toContain('https://app.growmate.tokyo/analytics/annotation-1');
      expect(content.html).toContain('75点');
      expect(content.html).toContain('合格ライン');
      expect(content.html).toContain('3位 / 10記事中');
      expect(content.html).toContain('見出し');
      expect(content.html).toContain('状況説明');
      expect(content.html).toContain('次の一手');
      expect(content.html).toContain('狙い');
      expect(content.html).toContain('2026/05/27〜2026/08/24');
      expect(content.html).toContain('2026/09/23');
    });

    it('narrative_failedのときは診断・次の一手を定型文へ置き換え、スコアと遷移先URLは通常どおり出す', () => {
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, status: 'narrative_failed', narrative: null });
      expect(content.html).toContain('診断コメントを作成できませんでした。スコアは算出済みです。');
      expect(content.html).not.toContain('次の一手');
      expect(content.html).toContain('75点');
      expect(content.html).toContain('https://app.growmate.tokyo/analytics/annotation-1');
    });

    it('サイト内順位が無ければ順位行を出さない', () => {
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, siteRank: null, totalArticles: null });
      expect(content.html).not.toContain('位 /');
    });

    it('評価対象期間が無ければ期間行を出さない', () => {
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, periodStart: null, periodEnd: null });
      expect(content.html).not.toContain('評価対象期間');
    });

    it('タイトルが長い場合は末尾を省略する', () => {
      const longTitle = 'あ'.repeat(60);
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, articleTitle: longTitle });
      expect(content.subject).toContain('…');
      expect(content.subject.length).toBeLessThan(longTitle.length + 30);
    });

    it('タイトル未取得時は記事URLのパスを使う', () => {
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, articleTitle: null });
      expect(content.subject).toContain('/blog/sample-article');
    });

    it('タイトルもURLも無ければフォールバック文言を使う', () => {
      const content = buildGa4ContentEvaluationEmail({ ...baseInput, articleTitle: null, canonicalUrl: null });
      expect(content.subject).toContain('（タイトル未取得）');
    });

    it('HTMLはsanitizeEmailHtmlを通り、scriptタグを含まない', () => {
      const content = buildGa4ContentEvaluationEmail({
        ...baseInput,
        articleTitle: '<script>alert(1)</script>',
      });
      expect(content.html).not.toContain('<script>');
    });
  });
});
