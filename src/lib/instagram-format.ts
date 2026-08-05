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
