/**
 * 評価状態の表示と認可
 *
 * 表示状態の解決（`ga4-evaluation-status`）、表示用のラベル・書式
 * （`ga4-evaluation-display`）、機能の認可判定（`ga4-permissions`）。
 *
 * 元は1モジュール1ファイルに分かれていた。探すときの単位が
 * 「取込 / 集計 / 評価 / 表示」であってモジュール名ではないため、
 * その単位でまとめている。どのモジュールの検査かは外側の describe が示す。
 */
import { describe, expect, it } from 'vitest';
import {
  applyGa4EvaluationFailure,
  resolveGa4EvaluationDisplayStatus,
} from '@/server/lib/ga4-evaluation-status';
import {
  getGa4DataQualityLabel,
  getGa4EvaluationErrorLabel,
  getGa4MissingMetricLabel,
} from '@/lib/ga4-evaluation-display';
import { canAccessGa4, canWriteGa4 } from '@/server/lib/ga4-permissions';

describe('@/server/lib/ga4-evaluation-status', () => {
  describe('ga4-evaluation-status', () => {
    it('評価中、永続状態を表示する', () => {
      expect(
        resolveGa4EvaluationDisplayStatus({
          persistedStatus: 'evaluating',
        })
      ).toBe('evaluating');
      expect(
        resolveGa4EvaluationDisplayStatus({
          persistedStatus: 'evaluated',
        })
      ).toBe('evaluated');
    });

    it('評価失敗時も直前の正常結果を保持する', () => {
      const projection = {
        status: 'evaluated' as const,
        lastSuccess: { historyId: 'history-id', evaluatedAt: '2026-08-08T00:00:00.000Z' },
        lastErrorCode: null,
      };

      expect(applyGa4EvaluationFailure(projection, 'llm_output_invalid')).toEqual({
        status: 'evaluation_failed',
        lastSuccess: projection.lastSuccess,
        lastErrorCode: 'llm_output_invalid',
      });
    });

    it('永続状態がない記事ではlow_data、eligible、unassessedを導出する', () => {
      expect(resolveGa4EvaluationDisplayStatus({ persistedStatus: null, derivedStatus: 'low_data' })).toBe('low_data');
      expect(resolveGa4EvaluationDisplayStatus({ persistedStatus: null, derivedStatus: 'eligible' })).toBe('eligible');
      expect(resolveGa4EvaluationDisplayStatus({ persistedStatus: null })).toBe('unassessed');
      expect(resolveGa4EvaluationDisplayStatus({ persistedStatus: 'narrative_failed' })).toBe('narrative_failed');
    });
  });
});

describe('@/lib/ga4-evaluation-display', () => {
  describe('ga4-evaluation-display', () => {
    it('欠損指標をユーザー向け表示へ変換し、未知キーを漏出させない', () => {
      expect(getGa4MissingMetricLabel('active_users')).toBe('読み手の人数データ');
      expect(getGa4MissingMetricLabel('internal_metric')).toBe('必要なデータ');
      expect(getGa4DataQualityLabel({ missingMetrics: ['active_users', 'gsc'], partial: true })).toBe('不足: 読み手の人数データ');
    });

    it('旧履歴に残るGSC欠損だけを品質エラーとして表示しない', () => {
      expect(getGa4DataQualityLabel({ missingMetrics: ['gsc'], reasons: ['gsc_summary_missing'], partial: true })).toBe('必要なデータを取得済み');
    });

    it('内部エラーコードをユーザー向け失敗理由へ変換する', () => {
      expect(getGa4EvaluationErrorLabel('llm_output_invalid')).toBe('診断コメントの形式を確認できませんでした');
      expect(getGa4EvaluationErrorLabel('unknown_internal_code')).toBe('評価に失敗しました');
    });
  });
});

describe('@/server/lib/ga4-permissions', () => {
  describe.each([
    ['admin', true],
    ['paid', true],
    ['trial', false],
    ['unavailable', false],
    [null, false],
  ] as const)('GA4権限 (%s)', (role, expected) => {
    it('読み取り認可を判定する', () => {
      expect(canAccessGa4({ role })).toBe(expected);
    });

    it('書き込み認可を判定する', () => {
      expect(canWriteGa4({ role })).toBe(expected);
    });
  });
});
