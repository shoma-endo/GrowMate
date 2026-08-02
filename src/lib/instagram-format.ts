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
