/**
 * コンテンツ評価履歴の見せ方（一覧行のラベル・配色と「前回」の特定）。
 *
 * 検索順位評価履歴（`components/evaluation-history/evaluation-history-view.ts`）と
 * 同じ構造へ揃えた際に切り出した純関数を検査する。パネル本体（.tsx）のレンダリング
 * テストは、このリポジトリにコンポーネントテストの基盤が無いため対象外。
 */
import { describe, expect, it } from 'vitest';

import {
  findPreviousScoredItem,
  getGa4EvaluationHistoryState,
} from '@/../app/analytics/[annotationId]/components/content-evaluation/ga4-evaluation-history-view';
import type { Ga4ContentEvaluationView } from '@/types/ga4-evaluation';

type History = Ga4ContentEvaluationView['history'];
type HistoryItem = History[number];

function buildHistoryItem(
  id: string,
  status: HistoryItem['status'],
  overrides: Partial<HistoryItem> = {}
): HistoryItem {
  return {
    id,
    status,
    startedAt: '2026-08-18T02:15:00.000Z',
    completedAt: '2026-08-18T02:16:00.000Z',
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
    ...overrides,
  };
}

function buildScoredItem(id: string, contentScore: number, overrides: Partial<HistoryItem> = {}) {
  return buildHistoryItem(id, 'evaluated', {
    contentScore,
    engageScore: contentScore,
    readScore: contentScore,
    diagnosisCode: 'R_GOOD',
    ...overrides,
  });
}

describe('getGa4EvaluationHistoryState', () => {
  it('評価済みは状態を小さい文字に、判定（診断コード）をバッジに出す', () => {
    const state = getGa4EvaluationHistoryState(buildScoredItem('a', 85));
    expect(state.showScoreTransition).toBe(true);
    expect(state.isError).toBe(false);
    expect(state.isNoData).toBe(false);
    expect(state.isRunning).toBe(false);
    // §10.4「評価履歴の状態表示は従来どおり『評価済み』を出す」
    expect(state.statusLabel).toBe('評価済み');
    expect(state.leadLabel).toBe('評価済み');
    expect(state.badgeLabel).toBe('良好');
  });

  it('診断コメント失敗もスコアは確定しているので判定バッジを出す', () => {
    const state = getGa4EvaluationHistoryState(
      buildScoredItem('a', 45, { status: 'narrative_failed', diagnosisCode: 'R_MID_EXIT' })
    );
    expect(state.showScoreTransition).toBe(true);
    expect(state.leadLabel).toBe('診断コメントを作成できませんでした');
    expect(state.badgeLabel).toBe('途中離脱型');
  });

  it('バッジの色はコンテンツ力スコアの点数帯で決まる', () => {
    expect(getGa4EvaluationHistoryState(buildScoredItem('a', 85)).badgeClassName).toContain(
      'bg-emerald-50'
    );
    expect(getGa4EvaluationHistoryState(buildScoredItem('b', 15)).badgeClassName).toContain(
      'bg-rose-100'
    );
  });

  it('すべてのバッジが枠の色を明示する', () => {
    // `ring-1 ring-inset` は色を指定しないと currentColor になり、
    // 薄い pill に濃い枠が付いて検索順位評価履歴と縁の濃さが食い違う
    for (const state of [
      getGa4EvaluationHistoryState(buildScoredItem('a', 85)),
      getGa4EvaluationHistoryState(buildHistoryItem('b', 'import_failed')),
      getGa4EvaluationHistoryState(buildHistoryItem('c', 'insufficient_data')),
      getGa4EvaluationHistoryState(buildHistoryItem('d', 'evaluating')),
    ]) {
      expect(state.badgeClassName).toMatch(/ring-(gray|red)-\d{3}\/\d+/);
    }
  });

  it('失敗2種はエラー扱いにし、状態ラベルで原因を区別する', () => {
    const importFailed = getGa4EvaluationHistoryState(buildHistoryItem('a', 'import_failed'));
    expect(importFailed.isError).toBe(true);
    expect(importFailed.showScoreTransition).toBe(false);
    expect(importFailed.leadLabel).toBe('エラー:');
    expect(importFailed.badgeLabel).toBe('データを取得できませんでした');
    expect(importFailed.badgeClassName).toContain('bg-red-50');

    const evaluationFailed = getGa4EvaluationHistoryState(
      buildHistoryItem('b', 'evaluation_failed')
    );
    expect(evaluationFailed.isError).toBe(true);
    expect(evaluationFailed.badgeLabel).toBe('評価に失敗しました');
  });

  it('データ不足はエラーにせず中立色で出す', () => {
    const state = getGa4EvaluationHistoryState(buildHistoryItem('a', 'insufficient_data'));
    expect(state.isNoData).toBe(true);
    expect(state.isError).toBe(false);
    expect(state.showScoreTransition).toBe(false);
    expect(state.leadLabel).toBe('状態:');
    expect(state.badgeLabel).toBe('データが不足しています');
    expect(state.badgeClassName).toContain('bg-gray-50');
  });

  it('実行中はスコアの遷移を出さない', () => {
    const state = getGa4EvaluationHistoryState(buildHistoryItem('a', 'evaluating'));
    expect(state.isRunning).toBe(true);
    expect(state.showScoreTransition).toBe(false);
    expect(state.badgeLabel).toBe('評価中です');
  });
});

describe('findPreviousScoredItem', () => {
  it('実行中・失敗の行を飛ばして直前の成功を返す', () => {
    const history: History = [
      buildScoredItem('latest', 70),
      buildHistoryItem('running', 'evaluating'),
      buildHistoryItem('failed', 'evaluation_failed'),
      buildScoredItem('previous', 55),
      buildScoredItem('older', 40),
    ];
    expect(findPreviousScoredItem(history, 0)?.id).toBe('previous');
  });

  it('スコアが欠けている行は前回として採らない', () => {
    const history: History = [
      buildScoredItem('latest', 70),
      buildScoredItem('broken', 60, { readScore: null }),
      buildScoredItem('previous', 55),
    ];
    expect(findPreviousScoredItem(history, 0)?.id).toBe('previous');
  });

  it('起点より新しい行は見ない（履歴は新しい順に並んでいる）', () => {
    const history: History = [
      buildScoredItem('newer', 80),
      buildScoredItem('anchor', 70),
      buildScoredItem('older', 55),
    ];
    expect(findPreviousScoredItem(history, 1)?.id).toBe('older');
  });

  it('前回が無ければ null を返す', () => {
    const history: History = [
      buildScoredItem('latest', 70),
      buildHistoryItem('failed', 'import_failed'),
    ];
    expect(findPreviousScoredItem(history, 0)).toBeNull();
    expect(findPreviousScoredItem(history, -1)).toBeNull();
  });
});
