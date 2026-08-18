import { describe, expect, it } from 'vitest';

import { calculateMediaScores, rankByContentScore } from '@/server/lib/ga4-content-score-aggregation';

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
