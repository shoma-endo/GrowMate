import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authMiddleware: vi.fn(),
  cookies: vi.fn(),
  generateSummary: vi.fn(),
  saveSummary: vi.fn(),
  resolveAllAnnotationIds: vi.fn(),
  selectRows: vi.fn(),
  now: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

vi.mock('@/server/middleware/auth.middleware', () => ({
  authMiddleware: mocks.authMiddleware,
}));
vi.mock('@/server/middleware/authMiddlewareGuards', () => ({
  getEmailLinkConflictMessage: () => undefined,
}));

vi.mock('@/server/services/contentAnnotationSummaryService', () => ({
  contentAnnotationSummaryService: {
    generateSummary: mocks.generateSummary,
    saveSummary: mocks.saveSummary,
  },
}));

vi.mock('@/server/services/analyticsContentService', () => ({
  analyticsContentService: {
    resolveAllAnnotationIds: mocks.resolveAllAnnotationIds,
  },
}));

vi.mock('@/server/services/supabaseService', () => ({
  SupabaseService: class {
    getClient() {
      return {
        from: () => ({
          select: () => ({
            eq: () => ({
              in: (_column: string, ids: string[]) => mocks.selectRows(ids),
            }),
          }),
        }),
      };
    }
  },
}));

import { summarizeContentAnnotationsBulk } from '@/server/actions/contentAnnotationBulkSummary.actions';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS,
  CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS,
} from '@/lib/constants';

const USER_ID = 'b0ed75ba-bb37-4dd7-89a0-c6ce940f991c';
const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

const emptyRow = (id: string, updatedAt: string) => ({
  id,
  updated_at: updatedAt,
  wp_post_id: 1,
  canonical_url: null,
  main_kw: null,
  kw: null,
  needs: null,
  persona: null,
  goal: null,
  prep: null,
  opening_proposal: null,
  basic_structure: null,
});

const generatedFields = {
  main_kw: 'kw',
  kw: null,
  needs: null,
  persona: null,
  goal: null,
  prep: null,
  opening_proposal: null,
  basic_structure: null,
  impressions: null,
};

function authAs(role: string | null) {
  mocks.authMiddleware.mockResolvedValue({
    userId: USER_ID,
    userDetails: role === null ? null : { role },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  authAs('paid');
  mocks.selectRows.mockResolvedValue({ data: [], error: null });
});

describe('認可（BR-07 / AC-07）', () => {
  it('trial は拒否する', async () => {
    authAs('trial');
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED);
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('role なしも拒否する', async () => {
    authAs(null);
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.success).toBe(false);
  });
});

describe('入力検証（BR-06 / AC-09b）', () => {
  it('0件はエラー', async () => {
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [],
    });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED);
  });

  it('1001件は1件も実行せずエラー', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => uuid(i + 1));
    const result = await summarizeContentAnnotationsBulk({ mode: 'ids', contentAnnotationIds: ids });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_LIMIT_EXCEEDED);
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('UUID でない ID は検証で弾く', async () => {
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: ['not-a-uuid'],
    });
    expect(result.error).toBe(ERROR_MESSAGES.COMMON.VALIDATION_FAILED);
  });
});

describe('全選択（mode: all）', () => {
  it('母集団の件数と取得 ID 数が食い違えば1件も実行しない（R-002）', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1)], total: 5 });
    const result = await summarizeContentAnnotationsBulk({ mode: 'all' });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_POPULATION_MISMATCH);
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('除外 ID は母集団から差し引く（突合は差し引く前で行う）', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1), uuid(2)], total: 2 });
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z')],
      error: null,
    });
    mocks.generateSummary.mockResolvedValue({
      success: true,
      fields: generatedFields,
      annotationId: uuid(1),
      userId: USER_ID,
    });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'all',
      excludedIds: [uuid(2)],
    });
    expect(result.success).toBe(true);
    expect(mocks.selectRows).toHaveBeenCalledWith([uuid(1)]);
    expect(result.data?.succeededCount).toBe(1);
  });

  it('全件を除外したらエラー', async () => {
    mocks.resolveAllAnnotationIds.mockResolvedValue({ ids: [uuid(1)], total: 1 });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'all',
      excludedIds: [uuid(1)],
    });
    expect(result.error).toBe(ERROR_MESSAGES.WORDPRESS.SUMMARY_BULK_TARGETS_REQUIRED);
  });
});

describe('4カテゴリ件数（FR-005）', () => {
  it('実行時点で埋まっていた記事はスキップに計上し、上書きしない（AC-05b）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [{ ...emptyRow(uuid(1), '2026-08-01T00:00:00Z'), main_kw: '手入力済み' }],
      error: null,
    });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.data).toMatchObject({ skippedCount: 1, succeededCount: 0, failedCount: 0 });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
    expect(mocks.saveSummary).not.toHaveBeenCalled();
  });

  it('WordPress 未連携の空欄記事は対象外としてスキップする（BR-02。失敗にしない）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [
        { ...emptyRow(uuid(1), '2026-08-01T00:00:00Z'), wp_post_id: null, canonical_url: '  ' },
      ],
      error: null,
    });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.data).toMatchObject({ skippedCount: 1, failedCount: 0, succeededCount: 0 });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('8項目すべて空で返ったら失敗に計上し保存しない（AC-04b）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z')],
      error: null,
    });
    mocks.generateSummary.mockResolvedValue({
      success: true,
      fields: { ...generatedFields, main_kw: null },
      annotationId: uuid(1),
      userId: USER_ID,
    });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1)],
    });
    expect(result.data).toMatchObject({
      failedCount: 1,
      succeededCount: 0,
      failedByCode: { EMPTY_SUMMARY: 1 },
    });
    expect(mocks.saveSummary).not.toHaveBeenCalled();
  });

  it('生成失敗は他件の処理を止めない（部分成功。BR-08 / AC-06）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z'), emptyRow(uuid(2), '2026-08-02T00:00:00Z')],
      error: null,
    });
    mocks.generateSummary
      .mockResolvedValueOnce({ success: false, code: 'SUMMARY_CONTENT_TOO_LARGE' })
      .mockResolvedValueOnce({
        success: true,
        fields: generatedFields,
        annotationId: uuid(2),
        userId: USER_ID,
      });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2)],
    });
    expect(result.data).toMatchObject({
      succeededCount: 1,
      failedCount: 1,
      // 当て推量ではなく、サーバーが特定した理由がそのまま返る
      failedByCode: { SUMMARY_CONTENT_TOO_LARGE: 1 },
    });
    expect(mocks.saveSummary).toHaveBeenCalledTimes(1);
  });

  it('取り直しで消えた ID（他人の記事・削除済み）は失敗に計上する', async () => {
    mocks.selectRows.mockResolvedValue({ data: [], error: null });
    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2)],
    });
    expect(result.data).toMatchObject({
      failedCount: 2,
      succeededCount: 0,
      failedByCode: { NOT_OWNED: 2 },
    });
  });
});

describe('時間予算（BR-03 / AC-05）', () => {
  it('残時間が後段予算を切ったら着手せず未実行に計上して打ち切る', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z'), emptyRow(uuid(2), '2026-08-02T00:00:00Z')],
      error: null,
    });
    mocks.generateSummary.mockImplementation(async () => {
      // 1件目の処理で予算を使い切らせる
      vi.setSystemTime(
        startedAt +
          CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS -
          CONTENT_ANNOTATION_BULK_SUMMARY_POST_LLM_BUFFER_MS -
          CONTENT_ANNOTATION_BULK_SUMMARY_MIN_ITEM_BUDGET_MS +
          1
      );
      return {
        success: true,
        fields: generatedFields,
        annotationId: uuid(1),
        userId: USER_ID,
      };
    });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    vi.useFakeTimers();
    const startedAt = Date.now();

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2)],
    });

    expect(result.data).toMatchObject({
      succeededCount: 1,
      unprocessedCount: 1,
      stoppedReason: 'time_budget',
    });
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
  });

  it('1件も着手できないときも件数を返す（応答は返す）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z')],
      error: null,
    });
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.resolveAllAnnotationIds.mockImplementation(async () => {
      vi.setSystemTime(startedAt + CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS);
      return { ids: [uuid(1)], total: 1 };
    });

    const result = await summarizeContentAnnotationsBulk({ mode: 'all' });
    expect(result.data).toMatchObject({
      succeededCount: 0,
      unprocessedCount: 1,
      stoppedReason: 'time_budget',
    });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });

  it('予算切れの残件にスキップ対象は含めない（未実行を水増ししない）', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [
        emptyRow(uuid(1), '2026-08-01T00:00:00Z'),
        // 既に入力済み = 実行しても一瞬でスキップされる。未実行に数えると
        // 「もう一度実行すると続きから進みます」と案内したのに1件も進まない
        { ...emptyRow(uuid(2), '2026-08-02T00:00:00Z'), main_kw: '入力済み' },
        emptyRow(uuid(3), '2026-08-03T00:00:00Z'),
      ],
      error: null,
    });
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.generateSummary.mockImplementation(async () => {
      vi.setSystemTime(startedAt + CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS);
      return { success: true, fields: generatedFields, annotationId: uuid(1), userId: USER_ID };
    });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2), uuid(3)],
    });

    expect(result.data).toMatchObject({
      succeededCount: 1,
      skippedCount: 1,
      unprocessedCount: 1,
      stoppedReason: 'time_budget',
    });
  });

  it('未実行はスキップ対象を含まない（再実行で進む件数と一致する）', async () => {
    // 要約対象は2件だけで、残り3件はすべて入力済み（実行しても一瞬でスキップされる）
    mocks.selectRows.mockResolvedValue({
      data: [
        emptyRow(uuid(1), '2026-08-01T00:00:00Z'),
        emptyRow(uuid(2), '2026-08-02T00:00:00Z'),
        { ...emptyRow(uuid(3), '2026-08-03T00:00:00Z'), main_kw: '入力済み' },
        { ...emptyRow(uuid(4), '2026-08-04T00:00:00Z'), main_kw: '入力済み' },
        { ...emptyRow(uuid(5), '2026-08-05T00:00:00Z'), main_kw: '入力済み' },
      ],
      error: null,
    });
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.generateSummary.mockImplementation(async () => {
      vi.setSystemTime(startedAt + CONTENT_ANNOTATION_BULK_SUMMARY_TIME_BUDGET_MS);
      return { success: true, fields: generatedFields, annotationId: uuid(1), userId: USER_ID };
    });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)],
    });

    // 「未実行 4 件」と案内して再実行で1件しか進まない、という数字の意味の崩れを防ぐ
    expect(result.data).toMatchObject({
      succeededCount: 1,
      skippedCount: 3,
      unprocessedCount: 1,
      stoppedReason: 'time_budget',
    });
  });
});

describe('例外の封じ込め', () => {
  it('1件が throw しても確定済みの件数は失われない', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [emptyRow(uuid(1), '2026-08-01T00:00:00Z'), emptyRow(uuid(2), '2026-08-02T00:00:00Z')],
      error: null,
    });
    mocks.generateSummary
      .mockRejectedValueOnce(new Error('unexpected'))
      .mockResolvedValueOnce({
        success: true,
        fields: generatedFields,
        annotationId: uuid(2),
        userId: USER_ID,
      });
    mocks.saveSummary.mockResolvedValue({ success: true, data: {} });

    const result = await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2)],
    });

    // 例外で全体が落ちると success:false になり、成功1件が利用者に伝わらない
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      succeededCount: 1,
      failedCount: 1,
      failedByCode: { UNEXPECTED: 1 },
    });
  });
});

describe('処理順序（§6 実行順序）', () => {
  it('updated_at 昇順で generateSummary を呼ぶ', async () => {
    mocks.selectRows.mockResolvedValue({
      data: [
        emptyRow(uuid(3), '2026-08-31T00:00:00Z'),
        emptyRow(uuid(1), '2026-08-01T00:00:00Z'),
        emptyRow(uuid(2), '2026-08-15T00:00:00Z'),
      ],
      error: null,
    });
    mocks.generateSummary.mockResolvedValue({ success: false, code: 'SUMMARY_AI_FAILED' });

    await summarizeContentAnnotationsBulk({
      mode: 'ids',
      contentAnnotationIds: [uuid(1), uuid(2), uuid(3)],
    });

    const calledIds = mocks.generateSummary.mock.calls.map(call => call[0].target.annotationId);
    expect(calledIds).toEqual([uuid(1), uuid(2), uuid(3)]);
  });
});
