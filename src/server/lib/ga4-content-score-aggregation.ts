export interface ContentScoreRankingItem {
  id: string;
  contentScore: number;
  sessions: number;
  readScore: number;
  engageScore: number;
}

export interface RankedContentScoreItem extends ContentScoreRankingItem {
  rank: number;
}

export function rankByContentScore(items: readonly ContentScoreRankingItem[]): RankedContentScoreItem[] {
  const sorted = [...items].sort((a, b) => b.contentScore - a.contentScore);
  let previousScore: number | null = null;
  let rank = 0;
  return sorted.map((item, index) => {
    if (item.contentScore !== previousScore) rank += 1;
    previousScore = item.contentScore;
    return { ...item, rank };
  });
}

export interface MediaContentScores {
  assetValueScore: number | null;
  effectiveScore: number | null;
  evaluatedCount: number;
  totalCount: number;
}

export function calculateMediaScores(
  items: readonly Pick<ContentScoreRankingItem, 'contentScore' | 'sessions'>[],
  totalCount?: number
): MediaContentScores {
  const resolvedTotalCount = totalCount ?? items.length;
  if (items.length === 0) return { assetValueScore: null, effectiveScore: null, evaluatedCount: 0, totalCount: resolvedTotalCount };
  const sum = items.reduce((total, item) => total + item.contentScore, 0);
  const sessionSum = items.reduce((total, item) => total + item.sessions, 0);
  const weighted = items.reduce((total, item) => total + item.contentScore * item.sessions, 0);
  return {
    assetValueScore: Math.round(sum / items.length),
    effectiveScore: sessionSum > 0 ? Math.round(weighted / sessionSum) : null,
    evaluatedCount: items.length,
    totalCount: resolvedTotalCount,
  };
}
