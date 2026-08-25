import { describe, expect, it } from 'vitest';

import { resolveCardHistoryItem } from '@/../app/analytics/[annotationId]/components/content-evaluation/latest-history';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

type History = Ga4ContentEvaluationView['history'];

function buildHistoryItem(
  id: string,
  status: History[number]['status']
): History[number] {
  return {
    id,
    status,
    startedAt: '2026-08-18T02:15:00.000Z',
    completedAt: '2026-08-18T02:15:00.000Z',
    attemptCount: 1,
    readRate: null,
    engageRate: null,
    scrollRate: null,
    readScore: null,
    engageScore: null,
    contentScore: null,
    diagnosisCode: null,
    siteRank: null,
    totalArticles: null,
    sessions: null,
    charCount: null,
    imageCount: null,
    expectedReadSeconds: null,
    avgEngagementSeconds: null,
    narrative: null,
    dataQuality: null,
    periodStart: null,
    periodEnd: null,
    ga4DataFetchedAt: null,
    errorCode: null,
  };
}

function buildView(
  history: History,
  lastSuccessHistoryId: string | null
): Ga4ContentEvaluationView {
  return {
    settingsEnabled: true,
    displayStatus: 'evaluated',
    missingMetrics: [],
    projection: {
      status: 'evaluated',
      lastSuccessHistoryId,
      lastSuccessEvaluatedAt: null,
      lastErrorCode: null,
    },
    history,
  };
}

describe('resolveCardHistoryItem', () => {
  it('projection の最終成功IDを最優先で返す', () => {
    const view = buildView(
      [buildHistoryItem('newer', 'evaluated'), buildHistoryItem('older', 'evaluated')],
      'older'
    );
    expect(resolveCardHistoryItem(view)?.id).toBe('older');
  });

  it('最終成功IDが無ければ成功扱いの最新を返す', () => {
    const view = buildView(
      [
        buildHistoryItem('failed', 'evaluation_failed'),
        buildHistoryItem('success', 'evaluated'),
      ],
      null
    );
    expect(resolveCardHistoryItem(view)?.id).toBe('success');
  });

  it('narrative_failed も成功扱いに含める（スコアは保存されているため）', () => {
    const view = buildView([buildHistoryItem('narrative', 'narrative_failed')], null);
    expect(resolveCardHistoryItem(view)?.id).toBe('narrative');
  });

  it('成功が1件も無ければ null を返す（履歴は全件そのまま残る）', () => {
    const view = buildView(
      [buildHistoryItem('a', 'evaluation_failed'), buildHistoryItem('b', 'evaluating')],
      null
    );
    expect(resolveCardHistoryItem(view)).toBeNull();
  });

  it('evaluation が null なら null を返す', () => {
    expect(resolveCardHistoryItem(null)).toBeNull();
  });
});
