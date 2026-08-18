import { describe, expect, it } from 'vitest';

import {
  getGa4DataQualityLabel,
  getGa4EvaluationErrorLabel,
  getGa4MissingMetricLabel,
} from '@/lib/ga4-evaluation-display';

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
