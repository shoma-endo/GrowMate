import { describe, expect, it } from 'vitest';

import {
  CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC,
  CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_MIN_LLM_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS,
  CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS,
} from '@/lib/constants';
import {
  computeSummaryItemBudgetMs,
  isGeneratedSummaryEmpty,
  isSummaryEmpty,
  isWordPressLinkedForSummary,
  orderTargetsForProcessing,
  SUMMARY_TARGET_FIELD_KEYS,
} from '@/server/lib/content-annotation-bulk-summary';

const filled = {
  main_kw: 'kw',
  kw: 'kw2',
  needs: 'needs',
  persona: 'persona',
  goal: 'goal',
  prep: 'prep',
  opening_proposal: 'opening',
  basic_structure: 'structure',
};

describe('未要約判定（BR-02）', () => {
  it('8項目すべてが null なら未要約', () => {
    const empty = Object.fromEntries(SUMMARY_TARGET_FIELD_KEYS.map(k => [k, null]));
    expect(isSummaryEmpty(empty)).toBe(true);
  });

  it('空文字・空白のみも未設定として扱う（SQL の btrim と揃える）', () => {
    const blank = Object.fromEntries(SUMMARY_TARGET_FIELD_KEYS.map(k => [k, '   ']));
    expect(isSummaryEmpty(blank)).toBe(true);
  });

  it('1項目でも埋まっていれば未要約ではない', () => {
    for (const key of SUMMARY_TARGET_FIELD_KEYS) {
      const one = { ...Object.fromEntries(SUMMARY_TARGET_FIELD_KEYS.map(k => [k, null])), [key]: 'x' };
      expect(isSummaryEmpty(one)).toBe(false);
    }
  });

  it('impressions は判定に含めない（saveSummary が更新しないため）', () => {
    const empty = Object.fromEntries(SUMMARY_TARGET_FIELD_KEYS.map(k => [k, null]));
    expect(isSummaryEmpty({ ...empty, impressions: '感想' })).toBe(true);
  });
});

describe('WordPress 連携判定（BR-02）', () => {
  it('wp_post_id が正なら連携済み', () => {
    expect(isWordPressLinkedForSummary({ wp_post_id: 12 })).toBe(true);
  });

  it('wp_post_id が 0 以下・null なら canonical_url を見る', () => {
    expect(isWordPressLinkedForSummary({ wp_post_id: 0 })).toBe(false);
    expect(isWordPressLinkedForSummary({ wp_post_id: null, canonical_url: 'https://e.com/a' })).toBe(
      true
    );
  });

  it('canonical_url が空白のみなら未連携', () => {
    expect(isWordPressLinkedForSummary({ wp_post_id: null, canonical_url: '  ' })).toBe(false);
  });
});

describe('生成結果が8項目すべて空なら成功にしない（AC-04b）', () => {
  it('すべて null なら空とみなす', () => {
    expect(isGeneratedSummaryEmpty(Object.fromEntries(SUMMARY_TARGET_FIELD_KEYS.map(k => [k, null])))).toBe(
      true
    );
  });

  it('1項目でも非空なら成功扱いにできる', () => {
    expect(isGeneratedSummaryEmpty({ ...filled, main_kw: null })).toBe(false);
  });
});

describe('処理順序は updated_at 昇順・id タイブレーク（§6 実行順序）', () => {
  it('古い順に並ぶ', () => {
    const sorted = orderTargetsForProcessing([
      { id: 'c', updated_at: '2026-08-30T00:00:00Z' },
      { id: 'a', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'b', updated_at: '2026-08-15T00:00:00Z' },
    ]);
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('updated_at が同値なら id 昇順で決定的に並ぶ', () => {
    const sorted = orderTargetsForProcessing([
      { id: 'b', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'a', updated_at: '2026-08-01T00:00:00Z' },
    ]);
    expect(sorted.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('updated_at が無い行は最も古いものとして先に処理する', () => {
    const sorted = orderTargetsForProcessing([
      { id: 'a', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'z', updated_at: null },
    ]);
    expect(sorted.map(t => t.id)).toEqual(['z', 'a']);
  });

  it('要約に失敗して updated_at だけ最新化された記事は次回の末尾へ回る（R-001 の回帰）', () => {
    // 前回 WP 取得だけ成功して updated_at が最新化された失敗記事 = failed
    const sorted = orderTargetsForProcessing([
      { id: 'failed', updated_at: '2026-08-31T00:00:00Z' },
      { id: 'untouched-1', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'untouched-2', updated_at: '2026-08-02T00:00:00Z' },
    ]);
    expect(sorted.map(t => t.id)).toEqual(['untouched-1', 'untouched-2', 'failed']);
  });

  it('元の配列を破壊しない', () => {
    const input = [
      { id: 'b', updated_at: '2026-08-02T00:00:00Z' },
      { id: 'a', updated_at: '2026-08-01T00:00:00Z' },
    ];
    orderTargetsForProcessing(input);
    expect(input.map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('時間予算から1件分の予算を算出する（BR-03）', () => {
  it('開始直後は LLM 180秒 + 本文取得分を1件の上限にする', () => {
    const budget = computeSummaryItemBudgetMs(0);
    expect(budget).toEqual({
      itemMs: CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS + CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS,
      llmMs: CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS,
    });
  });

  it('残時間が少なくなったら1件の上限も LLM も切り下げる', () => {
    const remaining = 100_000;
    const elapsed =
      CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
      remaining -
      CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS;
    const budget = computeSummaryItemBudgetMs(elapsed);
    expect(budget).toEqual({
      itemMs: remaining,
      llmMs: remaining - CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS,
    });
  });

  it('最低予算を割ったら着手しない（極小タイムアウトの偽失敗を作らない）', () => {
    const elapsed =
      CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
      CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS -
      CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS;
    expect(computeSummaryItemBudgetMs(elapsed)).not.toBeNull();
    expect(computeSummaryItemBudgetMs(elapsed + 1)).toBeNull();
  });

  it('予算を超過していても null（負の値を渡さない）', () => {
    expect(computeSummaryItemBudgetMs(CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS * 2)).toBeNull();
  });

  it('着手の下限は「本文取得 + LLM 最低」である', () => {
    // 下限を LLM 分だけで決めると、下限ぎりぎりで着手した1件は本文取得に使える時間が 0 になり
    // 必ずタイムアウトする。この下限が防ぐと宣言している事象そのものが起きる
    expect(CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS).toBe(
      CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS +
        CONTENT_ANNOTATION_BULK_SUMMARY_MIN_LLM_BUDGET_MS
    );
  });

  it('着手できる限りどの時点でも本文取得の予算が残る', () => {
    for (let elapsed = 0; elapsed < CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS; elapsed += 1_000) {
      const budget = computeSummaryItemBudgetMs(elapsed);
      if (!budget) continue;
      expect(budget.itemMs - budget.llmMs).toBe(CONTENT_ANNOTATION_BULK_SUMMARY_FETCH_BUDGET_MS);
      expect(budget.llmMs).toBeGreaterThanOrEqual(CONTENT_ANNOTATION_BULK_SUMMARY_MIN_LLM_BUDGET_MS);
      expect(budget.llmMs).toBeLessThanOrEqual(CONTENT_ANNOTATION_SUMMARY_LLM_TIMEOUT_MS);
    }
  });

  it('着手した1件が上限まで走っても maxDuration を超えない', () => {
    // 着手できる最後の瞬間
    const lastStartMs =
      CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
      CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS -
      CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS;
    const budget = computeSummaryItemBudgetMs(lastStartMs);
    expect(budget).not.toBeNull();
    const worstCaseMs =
      lastStartMs + (budget?.itemMs ?? 0) + CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS;
    expect(worstCaseMs).toBeLessThanOrEqual(CONTENT_ANNOTATION_BULK_SUMMARY_MAX_DURATION_SEC * 1000);
  });

  it('どの経過時間でも1件の期限は時間予算を超えない', () => {
    for (let elapsed = 0; elapsed < CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS; elapsed += 10_000) {
      const budget = computeSummaryItemBudgetMs(elapsed);
      if (!budget) continue;
      expect(elapsed + budget.itemMs).toBeLessThanOrEqual(
        CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
          CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS
      );
    }
  });
});
