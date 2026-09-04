'use client';

import * as React from 'react';
import { Bell, PlayCircle, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { CategoryFilterConfig } from '@/types/category';
import { SUMMARY_TARGET_COLUMN_LABELS } from '@/lib/content-annotation-bulk-summary-display';
import { ANALYTICS_STORAGE_KEYS } from '@/lib/constants';

interface CategoryFilterProps {
  categories: string[];
  selectedCategoryNames: string[];
  includeUncategorized: boolean;
  hasUnreadSuggestion: boolean;
  /**
   * 「評価未設定」＝評価サイクルが未登録の記事。
   * 2026-08-26 のサイクル統合で、サイクルを登録した時点でGSC検索順位評価とGA4コンテンツ評価が
   * 同時に始まるようになったため、系統別の「未開始」は存在しない。かつて併存していた
   * 「コンテンツ評価未開始」（= ga4_content_evaluations に行が無い）は「開始したか」ではなく
   * 「結果があるか」を見ており、サイクル登録済みでも本評価が走る2サイクル目まで true のままで、
   * その間ユーザーに取れるアクションが無かったため廃止した（§10.2 / §18）。
   */
  hasUnstartedGscEvaluation: boolean;
  /**
   * 「未要約」= AI要約対象8項目がすべて空 かつ WordPress 連携済み。
   * 定義は docs/plans/content-annotation-bulk-ai-summary-spec.md BR-02 が正本。
   */
  hasUnsummarized: boolean;
  onFilterChange: (selectedCategoryNames: string[], includeUncategorized: boolean) => void;
  onUnreadSuggestionChange: (value: boolean) => void;
  onUnstartedGscEvaluationChange: (value: boolean) => void;
  onUnsummarizedChange: (value: boolean) => void;
  onClearAll: () => void;
}

export default function CategoryFilter({
  categories,
  selectedCategoryNames,
  includeUncategorized,
  hasUnreadSuggestion,
  hasUnstartedGscEvaluation,
  onFilterChange,
  onUnreadSuggestionChange,
  onUnstartedGscEvaluationChange,
  hasUnsummarized,
  onUnsummarizedChange,
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
    hasUnsummarized;

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
            <span className="text-sm font-medium text-blue-800">評価未設定</span>
          </label>
          {/*
            このフィルターは「サイクルが未設定」だけを拾い、設定済みで結果が出ていない記事は
            拾わない（§15.4）。その差はラベルからは読み取れず、絞り込んで出てこなかった側の
            記事にユーザーが気づけないため、条件をここで開示する。
            既定で畳むのは、通常の絞り込み操作の邪魔をしないため。
            `details` は ContentEvaluationCard.tsx:143 と同じ既存パターン。
          */}
          <details className="mt-1 px-1 text-xs">
            <summary
              className="cursor-pointer text-gray-500 hover:text-gray-700"
              aria-label="評価未設定で絞り込まれる条件"
            >
              絞り込まれる条件
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-gray-500">
              <li>評価サイクルを設定していない記事だけが対象です。</li>
              <li>
                設定済みで、まだ結果が出ていない記事は含まれません（初回の計測待ち、Google
                Analytics 4と連携していない、セッションが30に達していない）。
              </li>
            </ul>
          </details>
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
        <div className="border rounded-md px-2 py-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-purple-50 px-1 py-1 rounded">
            <Checkbox
              checked={hasUnsummarized}
              onCheckedChange={checked => onUnsummarizedChange(!!checked)}
            />
            <Sparkles className="h-3.5 w-3.5 text-purple-600 flex-shrink-0" />
            <span className="text-sm font-medium text-purple-800">未要約</span>
          </label>
          {/*
            「未要約」も評価未設定と同じく、ラベルからは境界が読み取れない。
            とくに WordPress 未連携の空欄記事が対象外になることは、絞り込んで出てこなかった側の
            記事にユーザーが気づけないので開示する。
          */}
          <details className="mt-1 px-1 text-xs">
            <summary
              className="cursor-pointer text-gray-500 hover:text-gray-700"
              aria-label="未要約で絞り込まれる条件"
            >
              絞り込まれる条件
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-gray-500">
              <li>
                {/* 項目名と並び順は一覧の列見出し（ANALYTICS_COLUMNS）に合わせる。
                    ここだけ独自の呼び方にするとユーザーがどの欄か照合できない */}
                {SUMMARY_TARGET_COLUMN_LABELS.join('・')}の8項目がすべて空の記事だけが対象です。
              </li>
              <li>
                WordPress と連携していない記事は、8項目が空でも含まれません（本文を取得できず
                要約できないため）。
              </li>
            </ul>
          </details>
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
