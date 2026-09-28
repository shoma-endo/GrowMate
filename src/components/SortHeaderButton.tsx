import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

type SortOrder = 'asc' | 'desc';

/** 並べ替え中の列の `<th>` に付ける `aria-sort`。並べ替えていない列には付けない */
export function getAriaSort(isActive: boolean, order: SortOrder): 'ascending' | 'descending' | undefined {
  if (!isActive) return undefined;
  return order === 'asc' ? 'ascending' : 'descending';
}

interface SortHeaderButtonProps {
  label: string;
  isActive: boolean;
  order: SortOrder;
  onClick: () => void;
}

/**
 * 一覧の列見出しに置く並べ替えボタン。ブログ一覧（`AnalyticsTable`）と
 * Instagram タブ（`InstagramMediaTable`）で共通。
 *
 * 見出しの文字だけを押せる範囲にするため素の button を使う（ui/button は
 * 高さ・余白を持ち、見出しの行の高さと既存の見出しとの揃いが崩れる）。
 * 既存の QueryAnalysisTab は <th onClick> でキーボードから押せないため写さない。
 */
export function SortHeaderButton({ label, isActive, order, onClick }: SortHeaderButtonProps) {
  const SortIcon = !isActive ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      <SortIcon className="w-3 h-3" aria-hidden />
    </button>
  );
}
