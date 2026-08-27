const MIN_EVALUATION_SESSIONS = 30;
const WORDS_PER_MINUTE = 500;
const IMAGE_SECONDS = 3;

export const READ_ANCHORS = [
  [0, 0], [0.06, 20], [0.12, 40], [0.2, 60], [0.3, 80], [0.5, 100],
] as const;
export const ENGAGE_ANCHORS = [
  [0, 0], [0.3, 20], [0.4, 40], [0.5, 60], [0.6, 80], [0.8, 100],
] as const;

type Anchor = readonly [number, number];
type DiagnosisCode = 'R_TOP_EXIT' | 'R_MISMATCH' | 'R_MID_EXIT' | 'R_SKIM' | 'R_GOOD' | 'R_LOWDATA';

export interface DiagnosisResult {
  code: DiagnosisCode;
  auxiliaryLabel: '流し読み型' | null;
}

export interface Ga4ContentScoreInput {
  sessions: number;
  readRate: number | null;
  engagementRate: number | null;
  scrollRate: number | null;
}

export interface Ga4ContentScoreResult {
  status: 'evaluated' | 'low_data' | 'insufficient_data';
  readRate: number | null;
  engageRate: number | null;
  readScore: number | null;
  engageScore: number | null;
  contentScore: number | null;
  diagnosis: DiagnosisResult;
}

export function interpolateScore(value: number, anchors: readonly Anchor[]): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) throw new Error('スコアアンカーが空です');
  if (!Number.isFinite(value) || value <= first[0]) return 0;
  if (value >= last[0]) return 100;
  for (let index = 1; index < anchors.length; index += 1) {
    const right = anchors[index];
    const left = anchors[index - 1];
    if (!right || !left) {
      throw new Error('スコアアンカーが不正です');
    }
    const [rightRatio, rightScore] = right;
    const [leftRatio, leftScore] = left;
    if (value <= rightRatio) {
      const ratio = (value - leftRatio) / (rightRatio - leftRatio);
      return Math.round(leftScore + ratio * (rightScore - leftScore));
    }
  }
  return 100;
}

export function calculateExpectedReadSeconds(charCount: number, imageCount: number | null): number {
  if (!Number.isFinite(charCount) || charCount < 0) throw new Error('本文文字数が不正です');
  const validImageCount = imageCount === null ? 0 : imageCount;
  if (!Number.isFinite(validImageCount) || validImageCount < 0) throw new Error('画像点数が不正です');
  return Math.round((charCount / WORDS_PER_MINUTE) * 60 + validImageCount * IMAGE_SECONDS);
}

export function calculateAverageEngagementSeconds(
  engagementTimeSec: number,
  activeUsers: number | null
): number | null {
  if (activeUsers === null || activeUsers <= 0) return null;
  return engagementTimeSec / activeUsers;
}

export function calculateReadRate(
  averageEngagementSeconds: number | null,
  expectedReadSeconds: number
): number | null {
  if (averageEngagementSeconds === null || expectedReadSeconds <= 0) return null;
  return averageEngagementSeconds / expectedReadSeconds;
}

export function calculateContentScore(readScore: number, engageScore: number): number {
  // 丸めは仕様例 100×20→45 と一致させるために必要。
  return Math.round(Math.sqrt(readScore * engageScore));
}

export function resolveDiagnosis(
  readScore: number,
  engageScore: number,
  scrollRate: number | null
): DiagnosisResult {
  const code = readScore >= 80
    ? (engageScore < 60 ? 'R_MISMATCH' : 'R_GOOD')
    : readScore >= 60
      ? (engageScore >= 60 ? 'R_GOOD' : 'R_MISMATCH')
      : readScore >= 40
        ? (engageScore < 60 ? 'R_TOP_EXIT' : 'R_SKIM')
        : (engageScore < 60 ? 'R_TOP_EXIT' : 'R_MID_EXIT');
  const overridden = scrollRate !== null && scrollRate < 0.15 && readScore < 40
    ? 'R_TOP_EXIT'
    : code;
  const auxiliaryLabel = scrollRate !== null && scrollRate >= 0.4 && readScore < 40
    ? '流し読み型'
    : null;
  return { code: overridden, auxiliaryLabel };
}

export function evaluateGa4ContentScore(input: Ga4ContentScoreInput): Ga4ContentScoreResult {
  if (input.sessions < MIN_EVALUATION_SESSIONS) {
    return {
      status: 'low_data', readRate: input.readRate, engageRate: input.engagementRate,
      readScore: null, engageScore: null, contentScore: null,
      diagnosis: { code: 'R_LOWDATA', auxiliaryLabel: null },
    };
  }
  if (input.readRate === null || input.engagementRate === null) {
    return {
      status: 'insufficient_data', readRate: input.readRate, engageRate: input.engagementRate,
      readScore: null, engageScore: null, contentScore: null,
      diagnosis: { code: 'R_LOWDATA', auxiliaryLabel: null },
    };
  }
  const readScore = interpolateScore(input.readRate, READ_ANCHORS);
  const engageScore = interpolateScore(input.engagementRate, ENGAGE_ANCHORS);
  return {
    status: 'evaluated',
    readRate: input.readRate,
    engageRate: input.engagementRate,
    readScore,
    engageScore,
    contentScore: calculateContentScore(readScore, engageScore),
    diagnosis: resolveDiagnosis(readScore, engageScore, input.scrollRate),
  };
}
