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
