import { beforeEach, describe, expect, it, vi } from 'vitest';

// この判定が出す数は、トーストの「N件のコンテンツに改善提案があります」と
// 一覧のベルアイコンの両方になる。どちらも「提案文が存在する」という主張なので、
// 生成前・生成失敗（suggestion_summary が NULL）の行を含めてはいけない。
//
// 2026-08-26 のレビューで、本ブランチが `.not('suggestion_summary','is',null)` を
// 落としていたことが分かった。恒久失敗した行（3回リトライ後に打ち切り）は
// canMarkAsRead が false で既読にできず、トーストは duration: Infinity なので、
// ユーザーが消す手段の無い通知が残る状態だった。このファイルはその回帰を止める。
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  /** チェーンで呼ばれたフィルタを (method, column, value) で記録する */
  filterCalls: [] as Array<[string, string, unknown]>,
  resolveValue: { data: [] as Array<{ content_annotation_id: string }>, error: null as unknown },
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          mocks.filterCalls.push(['eq', column, value]);
          return query;
        },
        neq: (column: string, value: unknown) => {
          mocks.filterCalls.push(['neq', column, value]);
          return query;
        },
        not: (column: string, operator: string, value: unknown) => {
          mocks.filterCalls.push(['not', column, `${operator}:${String(value)}`]);
          return query;
        },
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(mocks.resolveValue).then(onFulfilled, onRejected),
      };
      mocks.from.mockImplementation(() => query);
      return { from: mocks.from };
    }
  },
}));

import { gscNotificationService } from '@/server/services/gscNotificationService';

const USER_ID = 'user-1';

describe('gscNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filterCalls.length = 0;
    mocks.resolveValue = { data: [], error: null };
  });

  it('提案文の無い行を数えないよう、クエリで suggestion_summary の NULL を除外する', async () => {
    await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(mocks.from).toHaveBeenCalledWith('gsc_article_evaluation_history');
    // 「提案文がある」ことを主張する通知なので、この条件が唯一の担保になる
    expect(mocks.filterCalls).toContainEqual(['not', 'suggestion_summary', 'is:null']);
  });

  it('BR-06: 他ユーザーの行を数えないよう user_id で絞る', async () => {
    await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(mocks.filterCalls).toContainEqual(['eq', 'user_id', USER_ID]);
  });

  it('既読・エラー・改善済みを除く条件を維持する', async () => {
    await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(mocks.filterCalls).toContainEqual(['eq', 'is_read', false]);
    expect(mocks.filterCalls).toContainEqual(['neq', 'outcome_type', 'error']);
    expect(mocks.filterCalls).toContainEqual(['not', 'outcome', 'is:null']);
    expect(mocks.filterCalls).toContainEqual(['neq', 'outcome', 'improved']);
  });

  it('同じ記事の複数行は1件に畳む（文言が「N件のコンテンツ」なので行数ではなく記事数）', async () => {
    mocks.resolveValue = {
      data: [
        { content_annotation_id: 'annotation-1' },
        { content_annotation_id: 'annotation-1' },
        { content_annotation_id: 'annotation-2' },
      ],
      error: null,
    };

    const result = await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(result.annotationIds).toEqual(['annotation-1', 'annotation-2']);
    await expect(gscNotificationService.getUnreadSuggestionsAnnotationCount(USER_ID)).resolves.toBe(2);
  });

  it('該当が無ければ0件を返す', async () => {
    const result = await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(result.annotationIds).toEqual([]);
    await expect(gscNotificationService.getUnreadSuggestionsAnnotationCount(USER_ID)).resolves.toBe(0);
  });

  it('クエリが失敗しても例外にせず0件として扱う（通知はベストエフォート）', async () => {
    mocks.resolveValue = { data: null as never, error: { message: 'boom' } };

    const result = await gscNotificationService.getAnnotationIdsWithUnreadSuggestions(USER_ID);

    expect(result.annotationIds).toEqual([]);
  });
});
