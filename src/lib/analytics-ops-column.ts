import type { CSSProperties } from 'react';

const ANALYTICS_OPS_COLLAPSED_WIDTH = 120;

/**
 * 展開時は表示中の行で一番広いセルに合わせる（行ごとにボタンの数が変わるため）。
 * 幅を指定しないと表の min-width の余りがこの列に配られて中身より広がるので、1px を指定して
 * nowrap の中身の幅まで縮ませる
 */
export function getAnalyticsOpsColumnStyle(expanded: boolean): CSSProperties {
  if (expanded) return { width: '1px' };
  return {
    width: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
    minWidth: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
    maxWidth: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
  };
}
