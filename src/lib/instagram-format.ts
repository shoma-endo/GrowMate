/**
 * Instagram の投稿プレビューで使う表示整形。
 * UI から切り離して単体で検証できるようにしている。
 */

/**
 * 指標の表示。`null`（取得できなかった）と `0`（実際に 0 件）を区別する。
 * この区別は転換前投稿の説明（`2108006`）と、審査時に「API が動いている」ことを
 * 示す根拠の両方に効くため、`-` を `0` に丸めないこと。
 */
export function formatCount(value: number | null): string {
  if (value == null) {
    return '-';
  }
  if (value >= 1000) {
    const rounded = value / 1000;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
  }
  return String(value);
}

/**
 * 投稿日の表示。**年を必ず含める。**
 * プレビューは「最新3件」であって「最近の3件」ではないため、
 * 何年も前の投稿が並ぶことがある（プロアカウント転換前の投稿など）。
 * 年が無いと 2019 年の投稿が今年のものに見える。
 */
export function formatPostedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} 投稿`;
}

/** 率 = (実数 ÷ reach) × 100、小数第1位で四捨五入（§11.3） */
export function calculateInstagramRate(numerator: number | null, reach: number | null): number | null {
  if (numerator == null || reach == null || reach <= 0) {
    return null;
  }
  const rate = (numerator / reach) * 100;
  return Math.round(rate * 10) / 10;
}

export function formatInstagramRate(value: number | null): string {
  if (value == null) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

export interface InstagramEngagementTarget {
  tierLabel: string | null;
  min: number;
  max: number;
  maxFollowers: number | null;
  firstTier: boolean;
}

const INSTAGRAM_ENGAGEMENT_TARGETS: readonly InstagramEngagementTarget[] = [
  { tierLabel: 'ライト／ビギナー', min: 6, max: 10, maxFollowers: 1000, firstTier: true },
  { tierLabel: 'ナノ', min: 4, max: 6, maxFollowers: 5000, firstTier: false },
  { tierLabel: null, min: 3, max: 4.5, maxFollowers: 10000, firstTier: false },
  { tierLabel: 'マイクロ', min: 2, max: 3.5, maxFollowers: 50000, firstTier: false },
  { tierLabel: 'ミドル', min: 1.5, max: 2.5, maxFollowers: 100000, firstTier: false },
  { tierLabel: 'メガ／インフルエンサー', min: 0.8, max: 1.5, maxFollowers: null, firstTier: false },
];

export function getInstagramEngagementTarget(
  followersCount: number | null
): InstagramEngagementTarget | null {
  if (followersCount === null) {
    return null;
  }
  return (
    INSTAGRAM_ENGAGEMENT_TARGETS.find(
      target => target.maxFollowers === null || followersCount < target.maxFollowers
    ) ?? null
  );
}

export function isInstagramEngagementTargetMet(
  rate: number | null,
  target: Pick<InstagramEngagementTarget, 'min'> | null
): boolean {
  return rate !== null && target !== null && rate >= target.min;
}

export function formatInstagramEngagementTargetLabel(
  followersCount: number,
  target: InstagramEngagementTarget
): string {
  const tier = target.tierLabel === null ? '' : `（${target.tierLabel}）`;
  const range = `${target.min.toFixed(1)}〜${target.max.toFixed(1)}%${target.firstTier ? ' 以上' : ''}`;
  return `フォロワー ${followersCount.toLocaleString('ja-JP')}人${tier}の目標: ${range}`;
}

export function formatSkipRate(value: number | null): string {
  if (value == null) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null) {
    return '-';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSec = Math.round(seconds % 60);
  return `${minutes}分${remainSec}秒`;
}
