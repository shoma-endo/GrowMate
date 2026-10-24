import type { CSSProperties } from 'react';

const ANALYTICS_OPS_COLLAPSED_WIDTH = 120;

/** 展開時は幅を指定せず、表示中の行で一番広いセルに合わせる（行ごとにボタンの数が変わるため） */
export function getAnalyticsOpsColumnStyle(expanded: boolean): CSSProperties | undefined {
  if (expanded) return undefined;
  return {
    width: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
    minWidth: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
    maxWidth: `${ANALYTICS_OPS_COLLAPSED_WIDTH}px`,
  };
}
