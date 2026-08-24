'use client';

import * as React from 'react';
import { Bell, PlayCircle, TrendingDown } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { CategoryFilterConfig } from '@/types/category';
import { ANALYTICS_STORAGE_KEYS } from '@/lib/constants';

interface CategoryFilterProps {
  categories: string[];
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  hasUnstartedGscEvaluation: boolean;
  hasUnstartedGa4Evaluation: boolean;
  hasGa4ContentScoreBelow: boolean;
  onFilterChange: (selectedCategoryNames: string[], includeUncategorized: boolean) => void;
  onUnreadSuggestionChange: (value: boolean) => void;
  onUnstartedGscEvaluationChange: (value: boolean) => void;
  onUnstartedGa4EvaluationChange: (value: boolean) => void;
  onGa4ContentScoreBelowChange: (value: boolean) => void;
  onClearAll: () => void;
}

export default function CategoryFilter({
  categories,
  selectedCategoryNames,
  includeUncategorized,
  hasUnreadSuggestion,
  hasUnstartedGscEvaluation,
  hasUnstartedGa4Evaluation,
  hasGa4ContentScoreBelow,
  onFilterChange,
  onUnreadSuggestionChange,
  onUnstartedGscEvaluationChange,
  onUnstartedGa4EvaluationChange,
  onGa4ContentScoreBelowChange,
  onClearAll,
}: CategoryFilterProps) {
  // フィルター変更時に永続化
  const syncToStorage = React.useCallback((names: string[], includeUncat: boolean) => {
    if (typeof window !== 'undefined') {
      const stored: CategoryFilterConfig = {
        selectedCategoryNames: names,
        includeUncategorized: includeUncat,
      };
      localStorage.setItem(ANALYTICS_STORAGE_KEYS.CATEGORY_FILTER, JSON.stringify(stored));
    }
  }, []);

  const toggleCategory = (categoryName: string) => {
    const nextNames = selectedCategoryNames.includes(categoryName)
      ? selectedCategoryNames.filter(name => name !== categoryName)
      : [...selectedCategoryNames, categoryName];
    
    onFilterChange(nextNames, includeUncategorized);
    syncToStorage(nextNames, includeUncategorized);
  };

  const selectAll = () => {
    onFilterChange(categories, true);
    syncToStorage(categories, true);
  };

  const clearAll = () => {
    onClearAll();
    // カテゴリ選択がゼロ（独立フィルターのみアクティブな状態）では localStorage を消さない。
    // 通知フィルターは永続化対象外のため、ここで保存済みカテゴリを破棄しない。
    if (selectedCategoryNames.length > 0 || includeUncategorized) {
      syncToStorage([], false);
    }
  };

  const hasAnySelection =
    selectedCategoryNames.length > 0 ||
    includeUncategorized ||
    hasUnreadSuggestion ||
    hasUnstartedGscEvaluation ||
    hasUnstartedGa4Evaluation ||
    hasGa4ContentScoreBelow;

  return (
    <div className="space-y-3">
      {!hasAnySelection && (
        <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
          フィルターが未選択のため、全件表示されます
        </p>
      )}

      {/* 状態フィルター（カテゴリではないので見出しを分ける） */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-700">状態でフィルター</span>

        <div className="border rounded-md px-2 py-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-blue-50 px-1 py-1 rounded">
            <Checkbox
              checked={hasUnstartedGscEvaluation}
              onCheckedChange={checked => onUnstartedGscEvaluationChange(!!checked)}
            />
            <PlayCircle className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
            <span className="text-sm font-medium text-blue-800">検索順位評価未開始</span>
          </label>
        </div>
        <div className="border rounded-md px-2 py-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-indigo-50 px-1 py-1 rounded">
            <Checkbox checked={hasUnstartedGa4Evaluation} onCheckedChange={checked => onUnstartedGa4EvaluationChange(!!checked)} />
            <PlayCircle className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />
            <span className="text-sm font-medium text-indigo-800">コンテンツ評価未開始</span>
          </label>
        </div>
        <div className="border rounded-md px-2 py-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-rose-50 px-1 py-1 rounded">
            <Checkbox
              checked={hasGa4ContentScoreBelow}
              onCheckedChange={checked => onGa4ContentScoreBelowChange(!!checked)}
            />
            <TrendingDown className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />
            <span className="text-sm font-medium text-rose-800">コンテンツ力スコア60点未満</span>
          </label>
        </div>

        <div className="border rounded-md px-2 py-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-amber-50 px-1 py-1 rounded">
            <Checkbox
              checked={hasUnreadSuggestion}
              onCheckedChange={checked => onUnreadSuggestionChange(!!checked)}
            />
            <Bell className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
            <span className="text-sm font-medium text-amber-800">改善提案あり</span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-700">カテゴリでフィルター</span>
          <p className="text-xs text-gray-500">複数選択時は、いずれかに該当するコンテンツを表示</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={selectAll} className="h-7 px-3 text-xs">
            全選択
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll} className="h-7 px-3 text-xs">
            全解除
          </Button>
        </div>
      </div>

      <div className="max-h-[200px] overflow-y-auto space-y-2">
        {categories.map(categoryName => (
          <label
            key={categoryName}
            className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
          >
            <Checkbox
              checked={selectedCategoryNames.includes(categoryName)}
              onCheckedChange={() => toggleCategory(categoryName)}
            />
            <span className="text-sm truncate">{categoryName}</span>
          </label>
        ))}

        {/* 未分類 */}
        <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded border-t pt-2 mt-2">
          <Checkbox
            checked={includeUncategorized}
            onCheckedChange={checked => {
              const nextVal = !!checked;
              onFilterChange(selectedCategoryNames, nextVal);
              syncToStorage(selectedCategoryNames, nextVal);
            }}
          />
          <span className="text-sm text-gray-600">未分類</span>
        </label>
      </div>

      {categories.length === 0 && (
        <p className="text-xs text-gray-500 text-center py-2">
          カテゴリが見つかりません。WordPressの記事を同期してください。
        </p>
      )}
    </div>
  );
}
